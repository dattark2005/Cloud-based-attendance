'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Camera as CameraIcon, 
  ShieldCheck, 
  CheckCircle2, 
  X, 
  Activity,
  Scan,
  RefreshCcw,
  Zap,
  Users
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { socketService } from '@/lib/socket';
import * as faceapi from 'face-api.js';

export default function StudentLiveSession() {
  const { lectureId } = useParams();
  const router = useRouter();
  const webcamRef = useRef<Webcam>(null);
  
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastVerified, setLastVerified] = useState<Date | null>(null);
  const [status, setStatus] = useState<'IDLE' | 'SCANNING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [confidence, setConfidence] = useState(0);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const res = await fetchWithAuth(`/sections/active`);
        const session = res.data?.sessions.find((s: any) => s._id === lectureId);
        if (!session) {
          toast.error('Session ended or not found');
          router.push('/student/dashboard');
          return;
        }
        setSessionInfo(session);
      } catch (err) {
        console.error(err);
      }
    };

    loadSession();

    const socket = socketService.connect();
    socket.emit('join_section', sessionInfo?.sectionId?._id || '');

    socket.on('session:ended', (data) => {
       if (data.lectureId === lectureId) {
         toast('Session has been ended by instructor', { icon: '🛑' });
         router.push('/student/dashboard');
       }
    });

    return () => {
      // socket.off
    };
  }, [lectureId, sessionInfo?.sectionId?._id]);

  // State
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [userFaceDescriptor, setUserFaceDescriptor] = useState<Float32Array | null>(null);

  // Load Models
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
      } catch (err) {
        console.error('Failed to load models:', err);
        toast.error('Failed to load biometric engine');
      }
    };
    loadModels();
  }, []);

  // Prepare User's Face Descriptor
  useEffect(() => {
    const prepareBiometrics = async () => {
      if (!modelsLoaded) return;
      try {
        const userRes = await fetchWithAuth('/auth/me');
        const user = userRes.data?.user;
        
        if (user?.faceImageUrl) {
            try {
                let objectUrl: string;

                if (user.faceImageUrl.startsWith('data:')) {
                    // It's a base64 data URL, use directly
                    const res = await fetch(user.faceImageUrl);
                    const blob = await res.blob();
                    objectUrl = URL.createObjectURL(blob);
                } else {
                    // It's an external URL, use proxy
                    const proxyUrl = `http://localhost:3001/api/auth/proxy-image?url=${encodeURIComponent(user.faceImageUrl)}`;
                    const imageRes = await fetch(proxyUrl);
                    if (!imageRes.ok) throw new Error(`Proxy fetch failed: ${imageRes.statusText}`);
                     const blob = await imageRes.blob();
                    objectUrl = URL.createObjectURL(blob);
                }
                
                // Load into face-api
                const img = await faceapi.fetchImage(objectUrl);
                const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
                
                if (detection) {
                    setUserFaceDescriptor(detection.descriptor);
                } else {
                    toast.error('Could not generate descriptor from enrolled image');
                }
                
                URL.revokeObjectURL(objectUrl);
                
            } catch (imgErr: any) {
                console.error('Image loading error:', imgErr);
                toast.error('Failed to load your enrolled face. Please re-enroll.');
            }
        } else {
            toast.error('No face enrollment found. Please update profile.');
        }
      } catch (err) {
        console.error('Failed to load user biometric profile', err);
      }
    };
    prepareBiometrics();
  }, [modelsLoaded]);

  // Auto-verify loop
  useEffect(() => {
    if (status === 'SUCCESS' || isVerifying || !sessionInfo || !userFaceDescriptor) return;

    const interval = setInterval(() => {
      handleVerify();
    }, 15000); // Verify every 15 seconds

    return () => clearInterval(interval);
  }, [status, isVerifying, sessionInfo, userFaceDescriptor]); // Added userFaceDescriptor dependency

  const handleVerify = async () => {
    if (isVerifying || !webcamRef.current || !userFaceDescriptor) return;

    setIsVerifying(true);
    setStatus('SCANNING');

    try {
      const video = webcamRef.current.video;
      if (!video || video.readyState !== 4) throw new Error('Camera not ready');

      // 1. Detect face in current frame
      const detection = await faceapi.detectSingleFace(video)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        throw new Error('No face detected. Please look at the camera.');
      }

      // 2. Compare with enrolled descriptor
      const distance = faceapi.euclideanDistance(userFaceDescriptor, detection.descriptor);
      const threshold = 0.5; // Strictness

      if (distance < threshold) {
        // MATCH FOUND
        const matchConfidence = 1 - distance;
        setStatus('SUCCESS');
        setLastVerified(new Date());
        setConfidence(matchConfidence);
        toast.success('Identity Verified!', { id: 'verify-status' });

        // 3. Log to backend (Proof of Presence)
        await fetchWithAuth(`/attendance/activity`, {
            method: 'POST',
            body: JSON.stringify({
                userId: sessionInfo.studentId, // or get from auth
                lectureId,
                type: 'ENTRY',
                confidence: matchConfidence,
                // No image sent, verification handled locally
            })
        });
        
        // Reset to idle
        setTimeout(() => setStatus('IDLE'), 5000);

      } else {
        throw new Error('Face does not match enrolled profile.');
      }

    } catch (err: any) {
      setStatus('ERROR');
      toast.error(err.message || 'Verification failed');
      // Reset status after error to allow retry
      setTimeout(() => setStatus('IDLE'), 3000);
    } finally {
      setIsVerifying(false);
    }
  };

  if (!sessionInfo) return <div className="min-h-screen bg-black flex items-center justify-center">
    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>;

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Session Banner */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1">
             <div className="flex items-center space-x-3">
               <div className="px-3 py-1 bg-primary/20 border border-primary/20 rounded-full">
                 <span className="text-[10px] font-black text-primary uppercase tracking-widest">Active Session</span>
               </div>
               <h1 className="text-3xl font-black tracking-tight">{sessionInfo.sectionId?.courseId?.courseName}</h1>
             </div>
             <p className="text-white/40 text-sm font-medium">Keep this window open to maintain your biometric presence record.</p>
          </div>
          <div className="flex items-center space-x-4">
             <div className="text-right">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Instructor</p>
                <p className="text-sm font-bold">{sessionInfo.teacherId?.fullName}</p>
             </div>
             <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
          {/* Main Camera View */}
          <div className="lg:col-span-3 space-y-6">
            <div className="relative aspect-video rounded-[45px] overflow-hidden border-4 border-white/5 bg-black group shadow-2xl">
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                className="w-full h-full object-cover grayscale-[0.2]"
                videoConstraints={{ facingMode: 'user' }}
              />

              {/* Overlay elements */}
              <div className="absolute inset-0 pointer-events-none">
                 {/* Scanning Effect */}
                 {status === 'SCANNING' && (
                   <motion.div 
                     initial={{ top: '0%' }}
                     animate={{ top: '100%' }}
                     transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                     className="absolute left-0 right-0 h-1 bg-primary/50 shadow-[0_0_20px_rgba(var(--primary-rgb),0.5)] z-10"
                   />
                 )}

                 {/* Corners */}
                 <div className="absolute top-8 left-8 w-12 h-12 border-t-4 border-l-4 border-primary/40 rounded-tl-2xl" />
                 <div className="absolute top-8 right-8 w-12 h-12 border-t-4 border-r-4 border-primary/40 rounded-tr-2xl" />
                 <div className="absolute bottom-8 left-8 w-12 h-12 border-b-4 border-l-4 border-primary/40 rounded-bl-2xl" />
                 <div className="absolute bottom-8 right-8 w-12 h-12 border-b-4 border-r-4 border-primary/40 rounded-br-2xl" />

                 {/* Status Indicator Overlay */}
                 <div className="absolute inset-0 flex items-center justify-center">
                   <AnimatePresence>
                     {status === 'SUCCESS' && (
                       <motion.div 
                         initial={{ scale: 0.5, opacity: 0 }}
                         animate={{ scale: 1, opacity: 1 }}
                         exit={{ scale: 0.5, opacity: 0 }}
                         className="bg-emerald-500/90 backdrop-blur-md p-8 rounded-full"
                       >
                         <CheckCircle2 className="w-16 h-16 text-white" />
                       </motion.div>
                     )}
                   </AnimatePresence>
                 </div>
              </div>

              {/* Bottom bar */}
              <div className="absolute bottom-0 left-0 right-0 p-8 pt-20 bg-gradient-to-t from-black via-black/50 to-transparent flex justify-between items-end">
                 <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full animate-pulse ${status === 'SUCCESS' ? 'bg-emerald-500' : 'bg-primary'}`} />
                    <div>
                       <p className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mb-1">Status</p>
                       <p className="text-sm font-black text-white uppercase tracking-wider">
                         {status === 'SCANNING' ? 'AI Analyzing...' : status === 'SUCCESS' ? 'Verified' : 'Active Monitoring'}
                       </p>
                    </div>
                 </div>
                 <button 
                  onClick={handleVerify}
                  disabled={isVerifying}
                  className="p-5 rounded-3xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 transition-all text-white active:scale-95"
                 >
                    <Scan className={`w-8 h-8 ${isVerifying ? 'animate-spin' : ''}`} />
                 </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-6 glass-card rounded-[35px] border-emerald-500/10 bg-emerald-500/5">
               <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center">
                     <ShieldCheck className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div>
                    <h5 className="font-bold text-sm tracking-tight text-emerald-500/80 uppercase tracking-widest">Biometric Guard Active</h5>
                    <p className="text-[10px] text-white/40 font-medium">Your presence is being logged to the tamper-proof ledger.</p>
                  </div>
               </div>
               {lastVerified && (
                 <div className="text-right">
                    <p className="text-[10px] font-bold text-emerald-500/40 uppercase tracking-widest">Last Check</p>
                    <p className="text-xs font-black text-emerald-500">{lastVerified.toLocaleTimeString()}</p>
                 </div>
               )}
            </div>
          </div>

          {/* Sidebar info */}
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-card p-10 rounded-[45px] space-y-8">
               <h3 className="text-xl font-bold tracking-tight">Active Session Info</h3>
               <div className="space-y-6">
                  <div className="space-y-1">
                     <p className="text-[8px] text-white/40 uppercase font-black tracking-widest">Class Code</p>
                     <p className="text-2xl font-black text-primary tracking-widest uppercase">{sessionInfo.sectionId?.joinCode}</p>
                  </div>
                  <div className="space-y-1">
                     <p className="text-[8px] text-white/40 uppercase font-black tracking-widest">Verification Strength</p>
                     <div className="flex items-center space-x-3">
                        <Activity className="w-4 h-4 text-emerald-500" />
                        <span className="text-sm font-bold">{confidence ? (confidence * 100).toFixed(1) : '--'}% Accuracy</span>
                     </div>
                  </div>
               </div>

               <div className="pt-4 space-y-3">
                  <div className="flex items-start space-x-3">
                    <div className="mt-1 w-1.5 h-1.5 bg-primary rounded-full shrink-0" />
                    <p className="text-[10px] text-white/40 font-medium leading-relaxed">System performs auto-recognition every 15 seconds to ensure continuous presence.</p>
                  </div>
                  <div className="flex items-start space-x-3">
                    <div className="mt-1 w-1.5 h-1.5 bg-primary rounded-full shrink-0" />
                    <p className="text-[10px] text-white/40 font-medium leading-relaxed">Keep your face centered and well-lit for optimal detection performance.</p>
                  </div>
               </div>

               <button 
                onClick={() => router.push('/student/dashboard')}
                className="w-full py-5 rounded-[28px] bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest hover:border-white/40 transition-all flex items-center justify-center space-x-2"
               >
                 <span>Exit Monitor</span>
                 <X className="w-4 h-4" />
               </button>
            </div>

            <div className="glass-card p-10 rounded-[45px] bg-gradient-to-br from-primary/10 via-transparent to-transparent border-primary/10 text-center space-y-4">
               <div className="w-14 h-14 bg-primary/20 rounded-full flex items-center justify-center mx-auto">
                 <Zap className="w-7 h-7 text-primary" />
               </div>
               <h4 className="font-bold text-sm uppercase tracking-widest">Network Speed</h4>
               <p className="text-[10px] text-white/30 font-medium">Synced with ultra-low latency via WebSocket Protocol v3.</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
