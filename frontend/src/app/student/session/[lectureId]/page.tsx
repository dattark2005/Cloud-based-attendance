'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, X, Activity, Scan, ShieldCheck, AlertTriangle, Loader2, Camera
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { socketService } from '@/lib/socket';

// ─── Types ────────────────────────────────────────────────────────────────────
type VerifyStatus = 'IDLE' | 'SCANNING' | 'SUCCESS' | 'ERROR';

export default function StudentLiveSession() {
  const { lectureId } = useParams<{ lectureId: string }>();
  const router = useRouter();
  const webcamRef = useRef<Webcam>(null);

  // Session + user data
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Attendance state
  const [status, setStatus] = useState<VerifyStatus>('IDLE');
  const [confidence, setConfidence] = useState(0);
  const [lastVerified, setLastVerified] = useState<Date | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [attendanceMarked, setAttendanceMarked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

    return () => {
      socket.off('session:ended');
    };
  }, [lectureId, router]);

  // ── 2. Mark attendance via Python face recognition ────────────────────────
  const handleFaceVerify = async () => {
    if (isVerifying || attendanceMarked) return;

    // Guard: face not registered
    if (!currentUser?.faceImageUrl && !currentUser?.faceRegisteredAt) {
      toast.error('You have not registered your face. Go to Profile to enroll.', {
        id: 'face-req',
        duration: 5000,
      });
      return;
    }

    if (!webcamRef.current) {
      toast.error('Camera not ready');
      return;
    }

    setIsVerifying(true);
    setStatus('SCANNING');
    setErrorMsg(null);

    try {
      // Capture webcam screenshot
      const screenshot = webcamRef.current.getScreenshot({ width: 640, height: 480 });
      if (!screenshot) throw new Error('Could not capture face image from camera. Check camera permissions.');

      // Call backend — Python face recognition service verifies identity
      const markRes = await fetchWithAuth('/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({
          lectureId,
          faceImage: screenshot,
        }),
      });

      if (markRes.success) {
        const conf = markRes.data?.attendanceRecord?.confidenceScore ?? 0;
        setStatus('SUCCESS');
        setLastVerified(new Date());
        setConfidence(conf);
        toast.success('✅ Attendance marked successfully!', { id: 'verify' });
        setAttendanceMarked(true);
        setTimeout(() => setStatus('IDLE'), 5000);
      } else {
        throw new Error(markRes.message || 'Attendance marking failed');
      }
    } catch (err: any) {
      setStatus('ERROR');
      const msg = err?.message || 'Verification failed';
      setErrorMsg(msg);

      if (err?.data?.faceNotRegistered) {
        toast('❌ Face not registered. Please go to Profile → Face ID to enroll.', {
          icon: '⚠️',
          duration: 6000,
        });
      } else if (err?.data?.serviceUnavailable) {
        toast.error('⚠️ Face recognition service is offline. Please try again later.', { duration: 6000 });
      } else if (err?.data?.proxyAttempt) {
        toast.error('🚫 Proxy attempt detected. Your face does not match the registered profile.', { duration: 6000 });
      } else {
        toast.error(msg);
      }
      setTimeout(() => { setStatus('IDLE'); setErrorMsg(null); }, 4000);
    } finally {
      setIsVerifying(false);
    }
  };

  if (!sessionInfo) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const faceNotEnrolled = !currentUser?.faceImageUrl && !currentUser?.faceRegisteredAt;

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

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* ── Main Content (3/5) ─────────────────── */}
          <div className="lg:col-span-3 space-y-6">
            {faceNotEnrolled ? (
              /* Face not enrolled */
              <div className="flex flex-col items-center justify-center p-12 glass-card rounded-[40px] border border-amber-500/20 bg-amber-500/5 text-center space-y-4">
                <AlertTriangle className="w-12 h-12 text-amber-500" />
                <h3 className="text-xl font-bold">Face Not Enrolled</h3>
                <p className="text-white/40 text-sm">
                  You need to enroll your face in your profile before you can mark attendance.
                  The Python AI service will verify your identity.
                </p>
                <button
                  onClick={() => router.push('/student/profile')}
                  className="px-6 py-3 bg-primary hover:bg-primary/80 rounded-full font-bold text-sm transition-all mt-4"
                >
                  Go to Profile to Enroll
                </button>
              </div>
            ) : (
              /* Face verification panel */
              <div className="space-y-4">
                {/* Webcam */}
                <div className="relative aspect-video rounded-[40px] overflow-hidden border-4 border-white/5 bg-black shadow-2xl">
                  <Webcam
                    ref={webcamRef}
                    audio={false}
                    screenshotFormat="image/jpeg"
                    className="w-full h-full object-cover"
                    videoConstraints={{ facingMode: 'user' }}
                  />

                  {/* Scanning animation */}
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

                    {/* Status overlay */}
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
                          {status === 'SCANNING' ? 'AI Analyzing...' : status === 'SUCCESS' ? 'Verified ✓' : attendanceMarked ? 'Done' : 'Ready'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleFaceVerify}
                      disabled={isVerifying || attendanceMarked}
                      className="p-4 rounded-3xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isVerifying
                        ? <Loader2 className="w-7 h-7 animate-spin" />
                        : <Scan className="w-7 h-7" />
                      }
                    </button>
                  </div>
                </div>

                {/* Mark Attendance Button */}
                {!attendanceMarked ? (
                  <button
                    onClick={handleFaceVerify}
                    disabled={isVerifying}
                    className="w-full py-5 rounded-3xl bg-primary hover:bg-primary/80 disabled:opacity-40 text-white font-black uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-3"
                  >
                    {isVerifying ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Verifying with Python AI...</>
                    ) : (
                      <><Camera className="w-5 h-5" /> Mark Attendance (Face Recognition)</>
                    )}
                  </button>
                ) : (
                  <div className="w-full py-5 rounded-3xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="font-black uppercase tracking-widest text-emerald-400 text-sm">Attendance Recorded</span>
                  </div>
                )}

                {/* Error message */}
                {status === 'ERROR' && errorMsg && (
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-rose-300">{errorMsg}</p>
                  </div>
                )}

                {/* Info note */}
                <div className="p-4 rounded-2xl bg-white/3 border border-white/5 text-center">
                  <p className="text-[10px] text-white/30">
                    🔒 Identity verified by Python AI face recognition model. Centre your face in the frame and ensure good lighting.
                  </p>
                </div>
              </div>
            )}

            {/* Status card */}
            <div className="flex items-center justify-between p-5 glass-card rounded-[30px] border-emerald-500/10 bg-emerald-500/5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h5 className="font-bold text-sm text-emerald-500/80 uppercase tracking-widest">Python AI Face Guard</h5>
                  <p className="text-[10px] text-white/40">Only your registered face can mark attendance — no proxy allowed.</p>
                </div>
              </div>
              {lastVerified && (
                <div className="text-right">
                  <p className="text-[10px] font-bold text-emerald-500/40 uppercase tracking-widest">Verified At</p>
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
                  <p className="text-sm font-bold mt-1">🤖 Python Face Recognition</p>
                </div>
                <div>
                  <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Status</p>
                  <p className={`text-sm font-bold mt-1 ${attendanceMarked ? 'text-emerald-400' : 'text-white/60'}`}>
                    {attendanceMarked ? '✅ Present' : '⏳ Pending'}
                  </p>
                </div>
                <div className="pt-2 space-y-2">
                  <p className="text-[9px] text-white/20">Click "Mark Attendance" and look directly at the camera.</p>
                  <p className="text-[9px] text-white/20">The Python AI model compares your face to your registered profile.</p>
                </div>
              </div>
              <button
                onClick={() => router.push('/student/dashboard')}
                className="w-full py-4 rounded-[24px] bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest hover:border-white/30 transition-all flex items-center justify-center gap-2"
              >
                Exit Session <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
