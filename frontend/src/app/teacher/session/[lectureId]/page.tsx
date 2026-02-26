'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Clock, Activity, ShieldCheck, CheckCircle2, UserCheck,
  Camera, AlertCircle, Navigation, Satellite, Scan, Loader2,
  RefreshCw, AlertTriangle, MapPin, X
} from 'lucide-react';
import { socketService } from '@/lib/socket';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import Webcam from 'react-webcam';

// ─── Types ───────────────────────────────────────────────────────────────────
interface GpsState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  timestamp: number | null;
  loading: boolean;
  error: string | null;
}

type GpsModalStep = 'gps' | 'face' | 'submitting' | 'done';

export default function TeacherLiveSession() {
  const { lectureId } = useParams();
  const router = useRouter();
  const webcamRef = useRef<Webcam>(null);

  // Session data
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [detectedStudents, setDetectedStudents] = useState<any[]>([]);
  const [stats, setStats] = useState({ present: 0, total: 0 });

  // Teacher self-attendance GPS modal
  const [showGpsModal, setShowGpsModal] = useState(false);
  const [gpsModalStep, setGpsModalStep] = useState<GpsModalStep>('gps');
  const [gps, setGps] = useState<GpsState>({ lat: null, lng: null, accuracy: null, timestamp: null, loading: false, error: null });
  const [capturedFace, setCapturedFace] = useState<string | null>(null);
  const [faceVerifying, setFaceVerifying] = useState(false);
  const [faceVerified, setFaceVerified] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [teacherAttendanceMarked, setTeacherAttendanceMarked] = useState(false);

  // ── 1. Fetch Session & Student Data ──────────────────────────────────────
  useEffect(() => {
    const fetchSessionData = async () => {
      try {
        const res = await fetchWithAuth(`/attendance/status/${lectureId}`);
        if (res.success) {
          setSessionInfo(res.data);
          const allStudents = res.data.lecture?.sectionId?.students || [];
          setStudents(allStudents);
          setStats({
            present: res.data.stats?.present || 0,
            total: allStudents.length,
          });
          const initialLogs = (res.data.attendanceRecords || []).map((r: any) => ({
            studentName: r.studentId?.fullName || 'Unknown',
            timestamp: r.markedAt,
            confidence: r.confidenceScore || 0,
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

  // ── 2. Socket: listen for new student attendance ──────────────────────────
  useEffect(() => {
    const socket = socketService.connect();
    socket.on('attendance:marked', (data: any) => {
      if (data.lectureId === lectureId) {
        setDetectedStudents(prev => [{
          studentName: data.studentName || 'Student',
          timestamp: new Date().toISOString(),
          confidence: data.confidence || 0,
        }, ...prev].slice(0, 50));
        setStats(prev => ({ ...prev, present: Math.min(prev.present + 1, prev.total) }));
      }
    });
    return () => { socket.off('attendance:marked'); };
  }, [lectureId]);

  // ── 3. GPS acquisition ───────────────────────────────────────────────────
  const acquireGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGps(g => ({ ...g, error: 'Geolocation not supported on this device.', loading: false }));
      return;
    }
    setGps(g => ({ ...g, loading: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
          loading: false,
          error: null,
        });
      },
      (err) => {
        const msgs: Record<number, string> = {
          1: 'Location permission denied. Please allow in browser settings.',
          2: 'Location unavailable. Move outdoors and retry.',
          3: 'GPS timed out. Retry when signal is stronger.',
        };
        setGps(g => ({ ...g, loading: false, error: msgs[err.code] || err.message }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // Auto-acquire GPS when modal opens
  useEffect(() => {
    if (showGpsModal && gpsModalStep === 'gps') acquireGps();
  }, [showGpsModal, gpsModalStep, acquireGps]);

  const openGpsModal = () => {
    setShowGpsModal(true);
    setGpsModalStep('gps');
    setGps({ lat: null, lng: null, accuracy: null, timestamp: null, loading: false, error: null });
    setCapturedFace(null);
    setFaceVerified(false);
    setFaceError(null);
  };

  const closeGpsModal = () => {
    setShowGpsModal(false);
    setGpsModalStep('gps');
    setCapturedFace(null);
    setFaceVerified(false);
    setFaceError(null);
  };

  const gpsOk = gps.lat && gps.lng && !gps.loading && !gps.error && (gps.accuracy ?? 999) <= 150;

  // ── 4. Face capture & verification ───────────────────────────────────────
  const captureFace = () => {
    const img = webcamRef.current?.getScreenshot({ width: 640, height: 480 });
    if (img) { setCapturedFace(img); setFaceError(null); setFaceVerified(false); }
    else toast.error('Could not capture face. Check camera permissions.');
  };

  const verifyFace = async () => {
    if (!capturedFace) { toast.error('Capture your face first'); return; }
    setFaceVerifying(true);
    setFaceError(null);
    try {
      const res = await fetchWithAuth('/biometric/face/verify', {
        method: 'POST',
        body: JSON.stringify({ faceImage: capturedFace }),
      });
      if (res.data?.verified) {
        setFaceVerified(true);
        toast.success(`✅ Identity confirmed! (${(res.data.confidence * 100).toFixed(0)}% match)`);
      } else {
        setFaceError('Face not recognised. Please look at the camera clearly and retake.');
        toast.error('Face verification failed.');
      }
    } catch (err: any) {
      const msg = err?.message || 'Face verification error.';
      if (err?.data?.serviceUnavailable) {
        setFaceError('⚠️ Face recognition service is offline. Please start the Python AI service.');
      } else {
        setFaceError(msg);
      }
      toast.error(msg);
    } finally {
      setFaceVerifying(false);
    }
  };

  // ── 5. Submit GPS + face teacher attendance ───────────────────────────────
  const submitTeacherAttendance = async () => {
    if (!gps.lat || !gps.lng || !capturedFace || !faceVerified) return;
    setGpsModalStep('submitting');
    try {
      // Capture classroom photo (reuse face image as proof — teacher already verified)
      const livePhoto = webcamRef.current?.getScreenshot({ width: 960, height: 720 }) || capturedFace;

      const res = await fetchWithAuth('/gps-attendance/mark', {
        method: 'POST',
        body: JSON.stringify({
          lectureId,
          lat: gps.lat,
          lng: gps.lng,
          accuracy: gps.accuracy,
          timestamp: gps.timestamp,
          clientTime: Date.now(),
          livePhoto,
          faceImage: capturedFace,
        }),
      });

      if (res.success) {
        setTeacherAttendanceMarked(true);
        setGpsModalStep('done');
        toast.success('✅ Your GPS attendance marked!');
      } else {
        throw new Error(res.message || 'GPS attendance failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'GPS attendance failed');
      setGpsModalStep('face');
    }
  };

  // ── 6. End session ────────────────────────────────────────────────────────
  const endSession = async () => {
    try {
      await fetchWithAuth(`/sections/${sessionInfo.lecture.sectionId._id}/end-session`, { method: 'POST' });
      toast.success('Session ended');
      router.push('/teacher/dashboard');
    } catch (err) {
      toast.error('Failed to end session');
    }
  };

  if (!sessionInfo) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center space-y-4">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-white/40 text-xs font-black uppercase tracking-widest">Loading Session...</p>
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
                <span className="text-[10px] font-black text-white uppercase tracking-widest">Live Session</span>
              </div>
              {teacherAttendanceMarked && (
                <div className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">✓ Your Attendance Marked</span>
                </div>
              )}
              <h1 className="text-3xl font-black tracking-tight">{sessionInfo.lecture?.sectionId?.courseId?.courseName}</h1>
            </div>
            <p className="text-white/40 text-sm font-medium">Classroom: {sessionInfo.lecture?.sectionId?.sectionName}</p>
          </div>
          <div className="flex gap-3">
            {/* Mark My Attendance button */}
            {!teacherAttendanceMarked ? (
              <button
                onClick={openGpsModal}
                className="px-6 py-4 bg-emerald-500/20 border border-emerald-500/30 hover:bg-emerald-500/30 text-emerald-300 rounded-[24px] text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2"
              >
                <Navigation className="w-4 h-4" /> Mark My Attendance (GPS)
              </button>
            ) : (
              <div className="px-6 py-4 bg-emerald-500/10 border border-emerald-500/20 rounded-[24px] text-xs font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Attendance Marked
              </div>
            )}
            <button
              onClick={endSession}
              className="px-8 py-4 bg-white/5 border border-white/10 hover:bg-rose-500 hover:border-rose-500 text-white rounded-[24px] text-xs font-black uppercase tracking-widest transition-all"
            >
              End Session
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Present', value: stats.present, color: 'text-emerald-400' },
            { label: 'Absent', value: stats.total - stats.present, color: 'text-rose-400' },
            { label: 'Enrolled', value: stats.total, color: 'text-white/60' },
          ].map(s => (
            <div key={s.label} className="glass-card p-6 rounded-[30px] text-center">
              <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Info notice */}
        <div className="glass-card p-6 rounded-[30px] border border-primary/20 bg-primary/5 flex items-start gap-4">
          <ShieldCheck className="w-6 h-6 text-primary shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-primary text-sm">Python AI Face Recognition Active</h4>
            <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
              Students mark their own attendance on their devices using the Python face recognition model.
              Only the student's own verified face can record their presence — no proxy attendance allowed.
              Use "Mark My Attendance (GPS)" above to record your own GPS + face-verified attendance.
            </p>
          </div>
        </div>

        {/* Detection Log */}
        <div className="glass-card p-8 rounded-[40px]">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Student Attendance Log
          </h3>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
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
                      {log.confidence > 0 ? `${(log.confidence * 100).toFixed(0)}% AI` : '✓'}
                    </span>
                  </motion.div>
                ))
              ) : (
                <div className="text-center py-10 opacity-30">
                  <p className="text-xs">No student attendance recorded yet</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── GPS + Face Teacher Attendance Modal ──────────────────────────────── */}
      <AnimatePresence>
        {showGpsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card w-full max-w-lg rounded-[40px] p-8 border border-white/10 space-y-6 max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Navigation className="w-5 h-5 text-emerald-400" />
                  Mark My Attendance
                </h2>
                {gpsModalStep !== 'submitting' && (
                  <button onClick={closeGpsModal} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Step: GPS */}
              {gpsModalStep === 'gps' && (
                <div className="space-y-4">
                  <p className="text-white/40 text-xs">Step 1 of 2 — Acquiring GPS location</p>
                  <div className={`p-5 rounded-[24px] border space-y-3 ${gps.error ? 'border-rose-500/20 bg-rose-500/5' : gpsOk ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/5 bg-white/3'}`}>
                    {gps.loading ? (
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                        <p className="text-sm font-bold">Acquiring GPS…</p>
                      </div>
                    ) : gps.error ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-rose-400" />
                          <p className="text-sm font-bold text-rose-400">GPS Error</p>
                        </div>
                        <p className="text-xs text-white/50">{gps.error}</p>
                        <button onClick={acquireGps} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold transition-all">
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      </div>
                    ) : gps.lat ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          <p className="text-sm font-bold text-emerald-400">GPS Fixed</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 bg-white/5 rounded-xl">
                            <p className="text-white/30 text-[9px] font-black uppercase tracking-widest">Latitude</p>
                            <p className="font-mono font-bold mt-0.5">{gps.lat.toFixed(6)}</p>
                          </div>
                          <div className="p-2 bg-white/5 rounded-xl">
                            <p className="text-white/30 text-[9px] font-black uppercase tracking-widest">Longitude</p>
                            <p className="font-mono font-bold mt-0.5">{gps.lng?.toFixed(6)}</p>
                          </div>
                          <div className="p-2 bg-white/5 rounded-xl col-span-2">
                            <p className="text-white/30 text-[9px] font-black uppercase tracking-widest">Accuracy</p>
                            <p className={`font-bold mt-0.5 text-sm ${(gps.accuracy ?? 999) <= 30 ? 'text-emerald-400' : (gps.accuracy ?? 999) <= 80 ? 'text-amber-400' : 'text-rose-400'}`}>
                              {gps.accuracy?.toFixed(0)} m
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Satellite className="w-6 h-6 text-emerald-400 animate-pulse" />
                        <p className="text-sm text-white/40">Waiting for GPS signal…</p>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setGpsModalStep('face')}
                    disabled={!gpsOk}
                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    <Scan className="w-4 h-4" /> Proceed to Face Verification
                  </button>
                </div>
              )}

              {/* Step: Face */}
              {gpsModalStep === 'face' && (
                <div className="space-y-4">
                  <p className="text-white/40 text-xs">Step 2 of 2 — Face verification via Python AI</p>

                  <div className="relative rounded-[24px] overflow-hidden aspect-video bg-black border border-white/10">
                    <Webcam
                      ref={webcamRef}
                      audio={false}
                      screenshotFormat="image/jpeg"
                      className="w-full h-full object-cover"
                      videoConstraints={{ facingMode: 'user' }}
                    />
                    <div className="absolute top-3 left-3 w-8 h-8 border-t-2 border-l-2 border-primary/50 rounded-tl-lg pointer-events-none" />
                    <div className="absolute top-3 right-3 w-8 h-8 border-t-2 border-r-2 border-primary/50 rounded-tr-lg pointer-events-none" />
                    <div className="absolute bottom-3 left-3 w-8 h-8 border-b-2 border-l-2 border-primary/50 rounded-bl-lg pointer-events-none" />
                    <div className="absolute bottom-3 right-3 w-8 h-8 border-b-2 border-r-2 border-primary/50 rounded-br-lg pointer-events-none" />
                    {faceVerified && (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20">
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="bg-emerald-500/90 backdrop-blur-md p-5 rounded-full">
                          <CheckCircle2 className="w-12 h-12 text-white" />
                        </motion.div>
                      </div>
                    )}
                  </div>

                  {capturedFace && !faceVerified && (
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/3 border border-white/5">
                      <img src={capturedFace} alt="Face captured" className="w-12 h-12 rounded-xl object-cover border border-white/10" />
                      <p className="text-xs text-white/40">Face captured. Click "Verify" to confirm identity via Python AI.</p>
                    </div>
                  )}

                  {faceError && (
                    <div className="flex items-start gap-3 p-3 rounded-2xl bg-rose-500/5 border border-rose-500/20">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-rose-300">{faceError}</p>
                    </div>
                  )}

                  {faceVerified && (
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <p className="text-xs font-bold text-emerald-400">Identity confirmed by Python AI — ready to submit!</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button onClick={() => setGpsModalStep('gps')} className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-xs font-bold transition-all">Back</button>
                    {!faceVerified ? (
                      <>
                        <button
                          onClick={captureFace}
                          disabled={faceVerifying}
                          className="flex-1 py-3 bg-white/10 hover:bg-white/15 disabled:opacity-30 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                        >
                          <Camera className="w-4 h-4" /> Capture
                        </button>
                        <button
                          onClick={verifyFace}
                          disabled={!capturedFace || faceVerifying}
                          className="flex-1 py-3 bg-primary hover:bg-primary/80 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                        >
                          {faceVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scan className="w-4 h-4" />}
                          {faceVerifying ? 'Verifying…' : 'Verify'}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={submitTeacherAttendance}
                        className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                      >
                        <MapPin className="w-4 h-4" /> Submit GPS Attendance
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Step: Submitting */}
              {gpsModalStep === 'submitting' && (
                <div className="text-center py-8 space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-emerald-400 mx-auto" />
                  <p className="font-bold">Submitting GPS attendance…</p>
                  <p className="text-xs text-white/30">Verifying location and recording your presence</p>
                </div>
              )}

              {/* Step: Done */}
              {gpsModalStep === 'done' && (
                <div className="text-center py-8 space-y-6">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
                    className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/30"
                  >
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                  </motion.div>
                  <div>
                    <h3 className="text-2xl font-black">Attendance Marked!</h3>
                    <p className="text-white/40 text-sm mt-2">Your GPS + face-verified attendance has been recorded.</p>
                  </div>
                  <button
                    onClick={closeGpsModal}
                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 rounded-2xl text-sm font-black uppercase tracking-widest transition-all"
                  >
                    Done
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
