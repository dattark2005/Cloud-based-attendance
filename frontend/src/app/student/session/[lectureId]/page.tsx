'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, X, Activity, Scan, Users, ShieldCheck, Mic, StopCircle, RefreshCw, Volume2, AlertTriangle
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { socketService } from '@/lib/socket';
import * as faceapi from 'face-api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type VerifyStatus = 'IDLE' | 'SCANNING' | 'SUCCESS' | 'ERROR';
type BiometricMode = 'FACE' | 'VOICE';

export default function StudentLiveSession() {
  const { lectureId } = useParams<{ lectureId: string }>();
  const router = useRouter();
  const webcamRef = useRef<Webcam>(null);

  // Session + user data
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Face recognition
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [userFaceDescriptor, setUserFaceDescriptor] = useState<Float32Array | null>(null);
  const [status, setStatus] = useState<VerifyStatus>('IDLE');
  const [confidence, setConfidence] = useState(0);
  const [lastVerified, setLastVerified] = useState<Date | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [attendanceMarked, setAttendanceMarked] = useState(false);

  // Biometric mode toggle
  const [biometricMode, setBiometricMode] = useState<BiometricMode>('FACE');

  // Voice recording
  const [voiceSentence, setVoiceSentence] = useState('My name is present today');
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ── 1. Load session & current user ──────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      try {
        const [sessionRes, userRes] = await Promise.all([
          fetchWithAuth('/sections/active'),
          fetchWithAuth('/auth/me'),
        ]);

        const user = userRes.data?.user;
        setCurrentUser(user);

        const session = sessionRes.data?.sessions?.find(
          (s: any) => s._id === lectureId || s._id?.toString() === lectureId
        );

        if (!session) {
          toast.error('Session ended or not found');
          router.push('/student/dashboard');
          return;
        }
        setSessionInfo(session);
      } catch (err) {
        toast.error('Failed to load session');
        router.push('/student/dashboard');
      }
    };

    loadData();

    const socket = socketService.connect();
    socket.emit('join_section', '');

    socket.on('session:ended', (data: any) => {
      if (data.lectureId === lectureId) {
        toast('Session ended by instructor', { icon: '🛑' });
        router.push('/student/dashboard');
      }
    });
  }, [lectureId, router]);

  // ── 2. Fetch voice sentence ─────────────────────────────────────────────
  useEffect(() => {
    fetchWithAuth('/biometric/voice/sentence')
      .then(r => setVoiceSentence(r.data?.sentence || 'My name is present today'))
      .catch(() => { });
  }, []);

  // ── 3. Load face-api.js models ──────────────────────────────────────────
  useEffect(() => {
    const loadModels = async () => {
      try {
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);
        setModelsLoaded(true);
      } catch {
        toast.error('Failed to load face recognition engine');
      }
    };
    loadModels();
  }, []);

  // ── 4. Prepare user's face descriptor from enrolled image ────────────────
  useEffect(() => {
    if (!modelsLoaded || !currentUser?.faceImageUrl) return;

    // If the stored face image URL is a placeholder (set during offline registration),
    // skip loading the descriptor — the student needs to re-enroll with a real image.
    const isPlaceholder = (url: string) =>
      url.includes('via.placeholder.com') ||
      url.includes('placeholder.com') ||
      url.includes('placehold') ||
      url.includes('?text=') ||
      url === 'https://via.placeholder.com/1?text=face';

    if (isPlaceholder(currentUser.faceImageUrl)) {
      toast('Your face registration was in fallback mode. Please re-enroll your face in Profile.', {
        icon: '⚠️',
        duration: 6000,
      });
      return;
    }

    const prepare = async () => {
      try {
        let objectUrl: string;
        if (currentUser.faceImageUrl.startsWith('data:')) {
          const res = await fetch(currentUser.faceImageUrl);
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
        } else {
          const proxyRes = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/auth/proxy-image?url=${encodeURIComponent(currentUser.faceImageUrl)}`
          );
          if (!proxyRes.ok) throw new Error('Proxy failed');
          const blob = await proxyRes.blob();
          // If we got back a tiny 1×1 image (transparent fallback), the real image wasn't available
          if (blob.size < 100) {
            toast.error('Could not load your enrolled face image. Please re-enroll in Profile.');
            return;
          }
          objectUrl = URL.createObjectURL(blob);
        }

        const img = await faceapi.fetchImage(objectUrl);
        const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
        URL.revokeObjectURL(objectUrl);

        if (detection) {
          setUserFaceDescriptor(detection.descriptor);
        } else {
          toast.error('Could not read your enrolled face. Please re-enroll.');
        }
      } catch {
        toast.error('Failed to load your biometric profile');
      }
    };

    prepare();
  }, [modelsLoaded, currentUser]);

  // ── 5. Auto-verify loop (face) ───────────────────────────────────────────
  useEffect(() => {
    if (biometricMode !== 'FACE' || attendanceMarked || isVerifying || !sessionInfo || !userFaceDescriptor) return;

    const interval = setInterval(handleFaceVerify, 15000);
    return () => clearInterval(interval);
  }, [biometricMode, attendanceMarked, isVerifying, sessionInfo, userFaceDescriptor]);

  // ── 6. Face verification ─────────────────────────────────────────────────
  const handleFaceVerify = async () => {
    if (isVerifying || !webcamRef.current || !userFaceDescriptor) return;
    setIsVerifying(true);
    setStatus('SCANNING');

    try {
      const video = webcamRef.current.video;
      if (!video || video.readyState !== 4) throw new Error('Camera not ready');

      const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
      if (!detection) throw new Error('No face detected. Please look at the camera.');

      const distance = faceapi.euclideanDistance(userFaceDescriptor, detection.descriptor);
      if (distance >= 0.5) throw new Error('Face does not match your enrolled profile.');

      const matchConfidence = 1 - distance;
      setStatus('SUCCESS');
      setLastVerified(new Date());
      setConfidence(matchConfidence);
      toast.success('Identity Verified!', { id: 'verify' });

      // Log attendance
      await fetchWithAuth('/attendance/activity', {
        method: 'POST',
        body: JSON.stringify({
          userId: currentUser?._id,
          lectureId,
          type: 'ENTRY',
          confidence: matchConfidence,
        }),
      });

      setAttendanceMarked(true);
      setTimeout(() => setStatus('IDLE'), 5000);
    } catch (err: any) {
      setStatus('ERROR');
      toast.error(err.message || 'Verification failed');
      setTimeout(() => setStatus('IDLE'), 3000);
    } finally {
      setIsVerifying(false);
    }
  };

  // ── 7. Voice recording ───────────────────────────────────────────────────
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await submitVoice(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setTimeout(() => stopVoiceRecording(), 5000);
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const submitVoice = async (blob: Blob) => {
    try {
      setStatus('SCANNING');
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = reader.result as string;
          const verifyRes = await fetchWithAuth('/biometric/voice/verify', {
            method: 'POST',
            body: JSON.stringify({ voiceAudio: base64, expectedText: voiceSentence }),
          });

          if (verifyRes.data?.verified) {
            setStatus('SUCCESS');
            setConfidence(verifyRes.data.confidence);
            setLastVerified(new Date());
            toast.success(`✅ Voice Verified! ${(verifyRes.data.confidence * 100).toFixed(0)}% match`);

            // Log attendance via activity
            await fetchWithAuth('/attendance/activity', {
              method: 'POST',
              body: JSON.stringify({
                userId: currentUser?._id,
                lectureId,
                type: 'ENTRY',
                confidence: verifyRes.data.confidence,
              }),
            });

            setAttendanceMarked(true);
            setTimeout(() => setStatus('IDLE'), 5000);
          } else {
            setStatus('ERROR');
            toast.error('Voice did not match. Try again.');
            setTimeout(() => setStatus('IDLE'), 3000);
          }
        } catch (err: any) {
          setStatus('ERROR');
          toast.error(err.message || 'Voice verification failed');
          setTimeout(() => setStatus('IDLE'), 3000);
        }
      };
      reader.readAsDataURL(blob);
    } catch {
      setStatus('ERROR');
      setTimeout(() => setStatus('IDLE'), 3000);
    }
  };

  if (!sessionInfo) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Session Banner */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="px-3 py-1 bg-primary/20 border border-primary/20 rounded-full">
                <span className="text-[10px] font-black text-primary uppercase tracking-widest">Active Session</span>
              </div>
              {attendanceMarked && (
                <div className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">✓ Attendance Recorded</span>
                </div>
              )}
            </div>
            <h1 className="text-3xl font-black tracking-tight">
              {sessionInfo.sectionId?.courseId?.courseName || 'Live Session'}
            </h1>
            <p className="text-white/40 text-sm">Instructor: {sessionInfo.teacherId?.fullName || '—'}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Class Code</p>
            <p className="text-2xl font-black text-primary tracking-widest">{sessionInfo.sectionId?.joinCode || '—'}</p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-3">
          <button
            onClick={() => setBiometricMode('FACE')}
            className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${biometricMode === 'FACE' ? 'bg-primary text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'
              }`}
          >
            <Scan className="w-4 h-4" /> Face Recognition
          </button>
          <button
            onClick={() => setBiometricMode('VOICE')}
            className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${biometricMode === 'VOICE' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'
              }`}
          >
            <Mic className="w-4 h-4" /> Voice Recognition
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* ── Main Content (3/5) ─────────────────── */}
          <div className="lg:col-span-3 space-y-6">
            {biometricMode === 'FACE' && !currentUser?.faceImageUrl ? (
              <div className="flex flex-col items-center justify-center p-12 glass-card rounded-[40px] border border-amber-500/20 bg-amber-500/5 text-center space-y-4">
                <AlertTriangle className="w-12 h-12 text-amber-500" />
                <h3 className="text-xl font-bold">Face Not Enrolled</h3>
                <p className="text-white/40 text-sm">You need to enroll your face in your profile before you can mark attendance using Face Recognition.</p>
                <button onClick={() => router.push('/student/profile')} className="px-6 py-3 bg-primary hover:bg-primary/80 rounded-full font-bold text-sm transition-all mt-4">Go to Profile to Enroll</button>
              </div>
            ) : biometricMode === 'VOICE' && !currentUser?.voiceRegisteredAt && !currentUser?.voiceAudioUrl ? (
              <div className="flex flex-col items-center justify-center p-12 glass-card rounded-[40px] border border-amber-500/20 bg-amber-500/5 text-center space-y-4">
                <AlertTriangle className="w-12 h-12 text-amber-500" />
                <h3 className="text-xl font-bold">Voice Not Enrolled</h3>
                <p className="text-white/40 text-sm">You need to enroll your voice print in your profile before you can mark attendance using Voice Recognition.</p>
                <button onClick={() => router.push('/student/profile')} className="px-6 py-3 bg-violet-600 hover:bg-violet-700 rounded-full font-bold text-sm transition-all mt-4">Go to Profile to Enroll</button>
              </div>
            ) : biometricMode === 'FACE' ? (
              /* FACE PANEL */
              <div className="relative aspect-video rounded-[40px] overflow-hidden border-4 border-white/5 bg-black shadow-2xl">
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  screenshotFormat="image/jpeg"
                  className="w-full h-full object-cover"
                  videoConstraints={{ facingMode: 'user' }}
                />
                <div className="absolute inset-0 pointer-events-none">
                  {status === 'SCANNING' && (
                    <motion.div
                      initial={{ top: '0%' }} animate={{ top: '100%' }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      className="absolute left-0 right-0 h-1 bg-primary/50 shadow-[0_0_20px_rgba(99,102,241,0.5)] z-10"
                    />
                  )}
                  {/* Corner brackets */}
                  <div className="absolute top-6 left-6 w-10 h-10 border-t-4 border-l-4 border-primary/40 rounded-tl-2xl" />
                  <div className="absolute top-6 right-6 w-10 h-10 border-t-4 border-r-4 border-primary/40 rounded-tr-2xl" />
                  <div className="absolute bottom-6 left-6 w-10 h-10 border-b-4 border-l-4 border-primary/40 rounded-bl-2xl" />
                  <div className="absolute bottom-6 right-6 w-10 h-10 border-b-4 border-r-4 border-primary/40 rounded-br-2xl" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <AnimatePresence>
                      {status === 'SUCCESS' && (
                        <motion.div
                          initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}
                          className="bg-emerald-500/90 backdrop-blur-md p-8 rounded-full"
                        >
                          <CheckCircle2 className="w-16 h-16 text-white" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                {/* Bottom bar */}
                <div className="absolute bottom-0 left-0 right-0 p-6 pt-20 bg-gradient-to-t from-black via-black/50 to-transparent flex justify-between items-end">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full animate-pulse ${status === 'SUCCESS' ? 'bg-emerald-500' : 'bg-primary'}`} />
                    <div>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Status</p>
                      <p className="text-sm font-black text-white uppercase tracking-wider">
                        {status === 'SCANNING' ? 'AI Analyzing...' : status === 'SUCCESS' ? 'Verified ✓' : 'Active Monitoring'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleFaceVerify}
                    disabled={isVerifying || attendanceMarked}
                    className="p-4 rounded-3xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Scan className={`w-7 h-7 ${isVerifying ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            ) : (
              /* VOICE PANEL */
              <div className="glass-card p-8 rounded-[40px] border border-violet-500/20 space-y-6">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-violet-400" /> Voice Attendance
                  </h3>
                  <p className="text-sm text-white/30 mt-1">
                    Record yourself saying the phrase below clearly. You have 5 seconds.
                  </p>
                </div>

                {/* Phrase */}
                <div className="p-6 rounded-3xl bg-violet-500/10 border border-violet-500/20">
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-400/50 mb-2">Say this phrase:</p>
                  <p className="text-2xl font-bold text-violet-100">"{voiceSentence}"</p>
                </div>

                {/* Recording button */}
                <button
                  onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                  disabled={attendanceMarked}
                  className={`w-full py-5 rounded-3xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 ${attendanceMarked
                    ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 cursor-not-allowed'
                    : isRecording
                      ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
                      : 'bg-violet-600 hover:bg-violet-700 text-white'
                    }`}
                >
                  {attendanceMarked ? (
                    <><CheckCircle2 className="w-5 h-5" /> Attendance Recorded</>
                  ) : isRecording ? (
                    <><StopCircle className="w-5 h-5" /> Listening... (tap to stop early)</>
                  ) : (
                    <><Mic className="w-5 h-5" /> Start Recording (5s)</>
                  )}
                </button>

                {/* Voice wave animation while recording */}
                {isRecording && (
                  <div className="flex items-center justify-center gap-1 py-2">
                    {[...Array(12)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ scaleY: [0.3, 1, 0.3] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.07 }}
                        className="w-1.5 bg-violet-400 rounded-full"
                        style={{ height: 24 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Status card */}
            <div className="flex items-center justify-between p-5 glass-card rounded-[30px] border-emerald-500/10 bg-emerald-500/5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h5 className="font-bold text-sm text-emerald-500/80 uppercase tracking-widest">Biometric Guard Active</h5>
                  <p className="text-[10px] text-white/40">Your presence is being logged and verified.</p>
                </div>
              </div>
              {lastVerified && (
                <div className="text-right">
                  <p className="text-[10px] font-bold text-emerald-500/40 uppercase tracking-widest">Last Verified</p>
                  <p className="text-xs font-black text-emerald-500">{lastVerified.toLocaleTimeString()}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Sidebar (2/5) ─────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-card p-8 rounded-[40px] space-y-6">
              <h3 className="text-xl font-bold">Session Info</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Verification Strength</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    <span className="text-lg font-bold">
                      {confidence ? `${(confidence * 100).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Method</p>
                  <p className="text-sm font-bold mt-1">{biometricMode === 'FACE' ? '🤖 Face Recognition' : '🎤 Voice Recognition'}</p>
                </div>
                <div className="pt-2 space-y-2">
                  <p className="text-[9px] text-white/20">Auto face scan runs every 15 seconds.</p>
                  <p className="text-[9px] text-white/20">Keep your face centered and well-lit.</p>
                </div>
              </div>
              <button
                onClick={() => router.push('/student/dashboard')}
                className="w-full py-4 rounded-[24px] bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest hover:border-white/30 transition-all flex items-center justify-center gap-2"
              >
                Exit Monitor <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
