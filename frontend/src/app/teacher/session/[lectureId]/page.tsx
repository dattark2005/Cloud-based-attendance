'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Clock,
  Activity,
  ShieldCheck,
  CheckCircle2,
  UserCheck,
  Camera,
  AlertCircle
} from 'lucide-react';
import { socketService } from '@/lib/socket';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import Webcam from 'react-webcam';
import * as faceapi from 'face-api.js';

export default function TeacherLiveSession() {
  const { lectureId } = useParams();
  const router = useRouter();

  // State
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [detectedStudents, setDetectedStudents] = useState<any[]>([]);
  const [stats, setStats] = useState({ present: 0, total: 0 });
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [faceMatcher, setFaceMatcher] = useState<faceapi.FaceMatcher | null>(null);
  const [isWebcamActive, setIsWebcamActive] = useState(true);

  // Refs
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognitionInterval = useRef<NodeJS.Timeout | null>(null);
  const lastLoggedTime = useRef<Record<string, number>>({});

  // 1. Load Face API Models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = '/models';
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        setModelsLoaded(true);
        toast.success('AI Models Loaded');
      } catch (err) {
        console.error('Failed to load models:', err);
        toast.error('Failed to load Face Recognition models');
      }
    };
    loadModels();
  }, []);

  // 2. Fetch Session & Student Data
  useEffect(() => {
    const fetchSessionData = async () => {
      try {
        const res = await fetchWithAuth(`/attendance/status/${lectureId}`);
        if (res.success) {
          setSessionInfo(res.data);
          // lecture.sectionId is now populated with courseId and students
          const allStudents = res.data.lecture?.sectionId?.students || [];
          setStudents(allStudents);
          setStats({
            present: res.data.stats?.present || 0,
            total: allStudents.length
          });

          // Initialize detected students from history
          const initialLogs = (res.data.attendanceRecords || []).map((r: any) => ({
            studentName: r.studentId?.fullName || 'Unknown',
            timestamp: r.markedAt,
            confidence: r.confidenceScore || 0
          }));
          setDetectedStudents(initialLogs);
        }
      } catch (err) {
        toast.error('Failed to load session data');
        router.push('/teacher/dashboard');
      }
    };
    if (lectureId) fetchSessionData();
  }, [lectureId, router]);

  // 3. Prepare Face Matcher (Reference Data)
  useEffect(() => {
    const prepareFaceMatcher = async () => {
      if (!modelsLoaded || students.length === 0) return;

      const labeledDescriptors: faceapi.LabeledFaceDescriptors[] = [];
      let loadedCount = 0;

      for (const student of students) {
        if (!student.faceImageUrl) continue;

        try {
          // Use fetchImage to handle CORS if needed
          const img = await faceapi.fetchImage(student.faceImageUrl);
          const detections = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();

          if (detections) {
            labeledDescriptors.push(
              new faceapi.LabeledFaceDescriptors(student._id, [detections.descriptor])
            );
            loadedCount++;
          }
        } catch (err) {
          console.warn(`Failed to process face for ${student.fullName}`);
        }
      }

      if (labeledDescriptors.length > 0) {
        setFaceMatcher(new faceapi.FaceMatcher(labeledDescriptors, 0.6));
        toast.success(`Biometric profiles loaded: ${loadedCount}/${students.length}`);
      } else {
        toast('No student biometric data found', { icon: '⚠️' });
      }
    };

    prepareFaceMatcher();
  }, [modelsLoaded, students]);

  // 4. Live Recognition Loop
  useEffect(() => {
    if (!modelsLoaded || !faceMatcher || !isWebcamActive) return;

    const detect = async () => {
      if (webcamRef.current && webcamRef.current.video?.readyState === 4 && canvasRef.current) {
        const video = webcamRef.current.video;
        const canvas = canvasRef.current;

        // Match canvas size to video
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);

        // Detect faces
        const detections = await faceapi.detectAllFaces(video)
          .withFaceLandmarks()
          .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        // Clear previous drawings
        const context = canvas.getContext('2d');
        context?.clearRect(0, 0, canvas.width, canvas.height);

        // Match detected faces
        resizedDetections.forEach(async (detection) => {
          const match = faceMatcher.findBestMatch(detection.descriptor);
          const box = detection.detection.box;
          const drawBox = new faceapi.draw.DrawBox(box, { label: match.toString() });
          drawBox.draw(canvas);

          // If known student detected with high confidence
          if (match.label !== 'unknown' && match.distance < 0.5) { // Lower distance = higher similarity
            const studentId = match.label;
            const now = Date.now();

            // Debounce: verify only every 10 seconds per student
            if (!lastLoggedTime.current[studentId] || now - lastLoggedTime.current[studentId] > 10000) {
              lastLoggedTime.current[studentId] = now;
              handleStudentDetected(studentId, 1 - match.distance);
            }
          }
        });
      }
    };

    recognitionInterval.current = setInterval(detect, 500); // 2 FPS

    return () => {
      if (recognitionInterval.current) clearInterval(recognitionInterval.current);
    };
  }, [modelsLoaded, faceMatcher, isWebcamActive]);

  const handleStudentDetected = async (studentId: string, confidence: number) => {
    try {
      // Find student details
      const student = students.find(s => s._id === studentId);
      if (!student) return;

      // Update local UI immediately for feedback using the local match result
      setDetectedStudents(prev => [{
        studentName: student.fullName,
        timestamp: new Date().toISOString(),
        confidence
      }, ...prev].slice(0, 50));

      setStats(prev => {
        // Prevent double counting in this session view
        return { ...prev, present: Math.min(prev.present + 1, prev.total) };
      });

      toast.success(`Verified: ${student.fullName}`, { icon: '✅' });

      // Optionally send a lightweight "ping" to backend to record this official entry
      // without sending the image for re-verification
      await fetchWithAuth('/attendance/activity', {
        method: 'POST',
        body: JSON.stringify({
          userId: studentId,
          lectureId,
          type: 'ENTRY',
          confidence,
          // No image sent, just the ID confirmation
        })
      });

    } catch (err) {
      console.error('Failed to log attendance:', err);
    }
  };

  const endSession = async () => {
    try {
      await fetchWithAuth(`/sections/${sessionInfo.lecture.sectionId._id}/end-session`, {
        method: 'POST'
      });
      toast.success('Session ended');
      router.push('/teacher/dashboard');
    } catch (err) {
      toast.error('Failed to end session');
    }
  };

  if (!sessionInfo) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center space-y-4">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-white/40 text-xs font-black uppercase tracking-widest">Initializing Secure Connection...</p>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1">
            <div className="flex items-center space-x-3">
              <div className="px-3 py-1 bg-rose-500 rounded-full animate-pulse shadow-lg shadow-rose-500/30">
                <span className="text-[10px] font-black text-white uppercase tracking-widest">Live Surveillance</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight">{sessionInfo.lecture?.sectionId?.courseId?.courseName}</h1>
            </div>
            <p className="text-white/40 text-sm font-medium">Classroom: {sessionInfo.lecture?.sectionId?.sectionName}</p>
          </div>
          <button
            onClick={endSession}
            className="px-8 py-4 bg-white/5 border border-white/10 hover:bg-rose-500 hover:border-rose-500 text-white rounded-[24px] text-xs font-black uppercase tracking-widest transition-all"
          >
            End Live Session
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Camera Feed */}
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-card p-4 rounded-[40px] border-white/5 relative overflow-hidden min-h-[500px] bg-black">
              {modelsLoaded ? (
                <div className="relative w-full h-full rounded-[30px] overflow-hidden">
                  <Webcam
                    ref={webcamRef}
                    audio={false}
                    screenshotFormat="image/jpeg"
                    className="w-full h-full object-cover"
                    videoConstraints={{ facingMode: "user" }}
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-full z-10"
                  />

                  {/* Overlay UI */}
                  <div className="absolute top-4 left-4 z-20 flex space-x-2">
                    <div className="px-4 py-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 flex items-center space-x-2">
                      <Camera className="w-4 h-4 text-primary" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-widest">CAM 01</span>
                    </div>
                    <div className="px-4 py-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-widest">Active</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                  <Activity className="w-12 h-12 text-primary animate-pulse" />
                  <p className="text-sm font-bold text-white/50">Loading Computer Vision Models...</p>
                </div>
              )}
            </div>

            <div className="glass-card p-8 rounded-[35px] flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-bold text-lg">Classroom Stats</h4>
                <p className="text-xs text-white/40">Real-time occupancy tracking</p>
              </div>
              <div className="flex space-x-12">
                <div className="text-center">
                  <p className="text-3xl font-black">{stats.present}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Present</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black text-white/20">{stats.total - stats.present}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Absent</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black text-white/20">{stats.total}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Enrolled</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Logs */}
          <div className="space-y-6">
            <div className="glass-card p-8 rounded-[40px] h-[600px] flex flex-col">
              <h3 className="text-xl font-bold mb-6 flex items-center space-x-2">
                <Activity className="w-5 h-5 text-primary" />
                <span>Detection Log</span>
              </h3>

              <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                <AnimatePresence>
                  {detectedStudents.length > 0 ? (
                    detectedStudents.map((log, i) => (
                      <motion.div
                        key={`${log.studentName}-${i}`}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-4 bg-white/5 rounded-2xl border border-white/5 flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                            <UserCheck className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold">{log.studentName}</p>
                            <p className="text-[10px] text-white/30 font-mono">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-500">
                          {(log.confidence * 100).toFixed(0)}%
                        </span>
                      </motion.div>
                    ))
                  ) : (
                    <div className="text-center py-10 opacity-30">
                      <p className="text-xs">No detections yet</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="glass-card p-6 rounded-[30px] border border-orange-500/20 bg-orange-500/5 flex items-start space-x-4">
              <AlertCircle className="w-6 h-6 text-orange-500 flex-shrink-0" />
              <div>
                <h4 className="font-bold text-orange-500 text-sm">Privacy Mode Active</h4>
                <p className="text-[10px] text-orange-500/60 leading-relaxed mt-1">
                  Video processing happens locally on this device. No facial data is transmitted to cloud servers during scanning.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
