'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Lock, ArrowRight, ShieldCheck, Mail, Camera, Mic, CheckCircle2, ChevronLeft, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import CameraCapture from '@/components/CameraCapture';
import VoiceRecorder from '@/components/VoiceRecorder';
import { fetchWithAuth } from '@/lib/api';

type LoginStep = 'CREDENTIALS' | 'BIOMETRIC_FACE' | 'BIOMETRIC_VOICE' | 'SUCCESS';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>('CREDENTIALS');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<any>(null);
  const [challenge, setChallenge] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Simulate initial login to get user role/id
      const res = await fetchWithAuth('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      const token = res.data?.accessToken;
      const loggedUser = res.data?.user;

      if (token) localStorage.setItem('token', token);
      setUser(loggedUser);

      if (loggedUser.role === 'ADMIN') {
        const challengeRes = await fetchWithAuth('/biometric/voice/sentence');
        setChallenge(challengeRes.data.sentence);
        setStep('BIOMETRIC_FACE');
      } else {
        setStep('SUCCESS');
      }
    } catch (err: any) {
      toast.error(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const onFaceCapture = async (faceImage: string) => {
    setLoading(true);
    try {
      await fetchWithAuth('/biometric/face/verify', {
        method: 'POST',
        body: JSON.stringify({ faceImage }),
      });
      toast.success('Face verified');
      setStep('BIOMETRIC_VOICE');
    } catch (err: any) {
      toast.error(err.message || 'Face verification failed');
    } finally {
      setLoading(false);
    }
  };

  const onVoiceRecord = async (voiceAudio: string) => {
    setLoading(true);
    try {
      await fetchWithAuth('/biometric/voice/verify', {
        method: 'POST',
        body: JSON.stringify({ voiceAudio, expectedText: challenge }),
      });
      toast.success('Voice verified');
      setStep('SUCCESS');
    } catch (err: any) {
      toast.error(err.message || 'Voice verification failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step === 'SUCCESS') {
      setTimeout(() => {
        router.push(user?.role === 'TEACHER' ? '/teacher/dashboard' : '/student/dashboard');
      }, 2000);
    }
  }, [step, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      <AnimatePresence mode="wait">
        {step === 'CREDENTIALS' && (
          <motion.div
            key="creds"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="w-full max-w-md glass-card p-10 rounded-[40px] space-y-8"
          >
            <div className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 bg-gradient-to-br from-amber-500/20 via-red-500/20 to-blue-500/20 rounded-2xl flex items-center justify-center mb-4">
                <ShieldCheck className="w-10 h-10 text-amber-400" />
              </div>
              <h1 className="text-3xl font-bold">Welcome Back</h1>
              <p className="text-white/50 text-sm">Secure biometric login portal</p>
            </div>

            <form onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div className="space-y-4">
                <div className="relative group">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 group-focus-within:text-primary transition-colors" />
                  <input
                    type="email"
                    placeholder="Institutional Email"
                    className="input-field pl-12"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 group-focus-within:text-primary transition-colors" />
                  <input
                    type="password"
                    placeholder="Password"
                    className="input-field pl-12"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary flex items-center justify-center space-x-2 py-4"
              >
                {loading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <span>Next Stage</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
          </motion.div>
        )}

        {step === 'BIOMETRIC_FACE' && (
          <motion.div
            key="face"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="w-full max-w-lg glass-card p-10 rounded-[40px] space-y-8"
          >
            <div className="flex items-center space-x-4 mb-2">
              <button onClick={() => setStep('CREDENTIALS')} className="p-2 rounded-full hover:bg-white/5 transition-all">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div>
                <h2 className="text-2xl font-bold flex items-center space-x-2">
                  <Camera className="w-6 h-6 text-blue-400" />
                  <span>Face Authentication</span>
                </h2>
                <div className="flex space-x-1 mt-1">
                  <div className="h-1 w-8 bg-amber-500 rounded-full"></div>
                  <div className="h-1 w-8 bg-white/10 rounded-full"></div>
                </div>
              </div>
            </div>
            <CameraCapture onCapture={onFaceCapture} title="Stage 1: Face Liveness" />
          </motion.div>
        )}

        {step === 'BIOMETRIC_VOICE' && (
          <motion.div
            key="voice"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="w-full max-w-lg glass-card p-10 rounded-[40px] space-y-8"
          >
            <div className="flex items-center space-x-4 mb-2">
              <button onClick={() => setStep('BIOMETRIC_FACE')} className="p-2 rounded-full hover:bg-white/5 transition-all">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div>
                <h2 className="text-2xl font-bold flex items-center space-x-2">
                  <Mic className="w-6 h-6 text-secondary" />
                  <span>Voice Identity Verification</span>
                </h2>
                <div className="flex space-x-1 mt-1">
                  <div className="h-1 w-8 bg-emerald-500 rounded-full"></div>
                  <div className="h-1 w-8 bg-secondary rounded-full"></div>
                </div>
              </div>
            </div>
            <VoiceRecorder onRecord={onVoiceRecord} sentence={challenge} />
          </motion.div>
        )}

        {step === 'SUCCESS' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md glass-card p-12 rounded-[40px] text-center space-y-6"
          >
            <div className="mx-auto w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 10, stiffness: 100 }}
              >
                <CheckCircle2 className="w-16 h-16 text-emerald-500" />
              </motion.div>
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Access Granted</h1>
              <p className="text-white/50 italic">Welcome back, {user?.fullName}</p>
            </div>
            <div className="pt-4">
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1.5 }}
                  className="h-full bg-emerald-500"
                />
              </div>
              <p className="text-[10px] text-white/30 mt-2 uppercase tracking-tighter">Initializing secure environment...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
