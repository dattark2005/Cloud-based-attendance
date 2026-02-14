'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Mail, Hash, BookOpen, Camera, ArrowRight, CheckCircle2, ChevronLeft, ShieldCheck, RefreshCw, Lock } from 'lucide-react';
import { toast } from 'react-hot-toast';
import CameraCapture from '@/components/CameraCapture';
import { fetchWithAuth } from '@/lib/api';

type RegStep = 'INFO' | 'FACE_ENROLL' | 'SUCCESS';

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isStandaloneFace = searchParams.get('only') === 'face';

  const [step, setStep] = useState<RegStep>(isStandaloneFace ? 'FACE_ENROLL' : 'INFO');
  const [loading, setLoading] = useState(false);
  const [skippedFace, setSkippedFace] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  
  // Suppress warnings from browser extensions
  useEffect(() => {
    const originalError = console.error;
    console.error = (...args) => {
      if (args[0]?.includes?.('Hydration failed') || args[0]?.includes?.('persistent-storage')) return;
      originalError.apply(console, args);
    };
  }, []);

  const [formData, setFormData] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    prn: '',
    rollNumber: '',
  });

  const [faceImages, setFaceImages] = useState<string[]>([]);
  const [currentAngleIndex, setCurrentAngleIndex] = useState(0);

  const ANGLES = [
    { label: "Look Straight", sub: "Neutral expression" },
    { label: "Turn Left", sub: "Slowly tilt your head" },
    { label: "Turn Right", sub: "Slowly tilt your head" },
    { label: "Tilt Up", sub: "Lightly lift your chin" }
  ];

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate numeric fields only for students
    if (!isTeacher) {
      if (!/^\d+$/.test(formData.prn)) {
        toast.error('PRN must be a numeric BigInt');
        return;
      }
      if (!/^\d+$/.test(formData.rollNumber)) {
        toast.error('Roll Number must be a numeric Integer');
        return;
      }
    }
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    
    if (isTeacher) {
      // Teachers skip face enrollment by default for now
      completeRegistrationOnly();
    } else {
      setStep('FACE_ENROLL');
    }
  };

  const completeRegistrationOnly = async () => {
    setLoading(true);
    try {
      const fullName = `${formData.firstName} ${formData.middleName} ${formData.lastName}`.trim();
      const { confirmPassword, prn, rollNumber, ...baseData } = formData;
      
      const dataToSend = {
        ...baseData,
        fullName,
        role: isTeacher ? 'TEACHER' : 'STUDENT',
        // Only include PRN/Roll if not a teacher
        ...(isTeacher ? {} : { prn, rollNumber })
      };

      const userRes = await fetchWithAuth('/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataToSend),
      });
      
      const token = userRes.data?.accessToken;
      if (token) localStorage.setItem('token', token);
      
      setSkippedFace(true);
      toast.success(isTeacher ? 'Teacher account created' : 'Account created (Face enrollment skipped)');
      setStep('SUCCESS');
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const onFaceCapture = async (faceImage: string) => {
    if (loading) return;
    const newImages = [...faceImages, faceImage];
    
    if (newImages.length < 4) {
      setFaceImages(newImages);
      setCurrentAngleIndex(newImages.length);
      toast.success(`${ANGLES[newImages.length - 1].label} captured`);
      return;
    }

    // All 4 captured, proceed to registration
    setLoading(true);
    setFaceImages(newImages); // Ensure state is updated before API call
    
    try {
      if (!isStandaloneFace) {
        const fullName = `${formData.firstName} ${formData.middleName} ${formData.lastName}`.trim();
        const { confirmPassword, ...dataToSend } = formData;

        // 1. Create User Account
        const userRes = await fetchWithAuth('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ 
            ...dataToSend, 
            fullName,
            role: 'STUDENT' 
          }),
        });

        const token = userRes.data?.accessToken;
        if (token) {
          localStorage.setItem('token', token);
        } else {
          throw new Error('Authentication token not received');
        }
      }

      // 2. Enroll Faces (Batch)
      await fetchWithAuth('/biometric/face/register', {
        method: 'POST',
        body: JSON.stringify({ faceImages: newImages }),
      });

      toast.success(isStandaloneFace ? 'Biometric profile updated' : 'Registration successful');
      setStep('SUCCESS');

      // Auto-redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.push(isTeacher ? '/teacher/dashboard' : '/student/dashboard?enrolled=true');
      }, 2000);
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
      // DON'T reset faceImages immediately so user can see they reached 4/4
      // and maybe retry or check why it failed.
      // But we should reset if they want to try again.
      console.error('Registration Flow Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative" suppressHydrationWarning>
      <AnimatePresence mode="wait">
        {step === 'INFO' && (
          <motion.div 
            key="info"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-2xl glass-card p-10 rounded-[40px] space-y-8"
          >
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold text-gradient">{isTeacher ? 'Teacher Registration' : 'Registration'}</h1>
              <p className="text-white/50 text-sm">Create your account to access the dashboard</p>
            </div>

            <form onSubmit={handleInfoSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Role Toggle */}
              <div className="md:col-span-3 flex flex-col items-center pb-4 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Select Role</span>
                <div className="bg-white/5 p-1 rounded-full border border-white/5 flex">
                  <button
                    suppressHydrationWarning
                    type="button"
                    onClick={() => setIsTeacher(false)}
                    className={`px-6 py-2 rounded-full text-xs font-bold transition-all ${!isTeacher ? 'bg-primary text-white shadow-lg shadow-primary/25' : 'text-white/40 hover:text-white'}`}
                  >
                    Student
                  </button>
                  <button
                    suppressHydrationWarning
                    type="button"
                    onClick={() => setIsTeacher(true)}
                    className={`px-6 py-2 rounded-full text-xs font-bold transition-all ${isTeacher ? 'bg-secondary text-white shadow-lg shadow-secondary/25' : 'text-white/40 hover:text-white'}`}
                  >
                    Teacher
                  </button>
                </div>
              </div>

              {/* Name Fields */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">First Name</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                  <input 
                    className="input-field pl-12 text-sm" placeholder="John" required 
                    value={formData.firstName}
                    onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                    suppressHydrationWarning
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">Middle Name</label>
                <div className="relative">
                  <input 
                    className="input-field px-5 text-sm" placeholder="Quincy"
                    value={formData.middleName}
                    onChange={(e) => setFormData({...formData, middleName: e.target.value})}
                    suppressHydrationWarning
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">Last Name</label>
                <div className="relative">
                  <input 
                    className="input-field px-5 text-sm" placeholder="Doe" required 
                    value={formData.lastName}
                    onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              {/* Other Fields */}
              <div className="md:col-span-3 space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">
                  {isTeacher ? 'Institutional Email' : 'Student Email'}
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                  <input 
                    type="email" className="input-field pl-12 text-sm" placeholder="john.doe@university.edu" required 
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              {!isTeacher && (
                <>
                  <div className="md:col-span-1.5 space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">PRN (BigInt)</label>
                    <div className="relative">
                      <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
                      <input 
                        className="input-field pl-12 text-sm" placeholder="123456789012" required 
                        value={formData.prn}
                        onChange={(e) => setFormData({...formData, prn: e.target.value.replace(/\D/g, '')})}
                        suppressHydrationWarning
                      />
                    </div>
                  </div>

                  <div className="md:col-span-1.5 space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">Roll No (Int)</label>
                    <div className="relative">
                      <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
                      <input 
                        className="input-field pl-12 text-sm" placeholder="42" required 
                        value={formData.rollNumber}
                        onChange={(e) => setFormData({...formData, rollNumber: e.target.value.replace(/\D/g, '')})}
                        suppressHydrationWarning
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="md:col-span-1 space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">Account Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                  <input 
                    type="password" 
                    className="input-field pl-12 text-sm" 
                    placeholder="••••••••" 
                    required 
                    minLength={6}
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 ml-1">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/50" />
                  <input 
                    type="password" 
                    className="input-field pl-12 text-sm" 
                    placeholder="••••••••" 
                    required 
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              <div className="md:col-span-3 pt-6" suppressHydrationWarning>
                <button 
                  type="submit" 
                  className="w-full btn-primary flex items-center justify-center space-x-3 py-4 group"
                  suppressHydrationWarning
                >
                  <span className="font-bold tracking-tight">
                    {isTeacher ? 'Complete Teacher Registration' : 'Proceed to Face Enrollment'}
                  </span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {step === 'FACE_ENROLL' && (
          <motion.div 
            key="face"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-full max-w-lg glass-card p-10 rounded-[40px] space-y-8 relative overflow-hidden"
          >
            {/* Step Progress Bar */}
            <div className="absolute top-0 left-0 h-1 bg-primary/20 w-full">
              <motion.div 
                className="h-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${((faceImages.length) / 4) * 100}%` }}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button 
                  onClick={() => { 
                    if (isStandaloneFace) {
                      router.push('/student/dashboard');
                    } else {
                      setStep('INFO'); 
                      setFaceImages([]); 
                      setCurrentAngleIndex(0); 
                    }
                  }} 
                  className="p-2 rounded-full hover:bg-white/5 transition-all"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <h2 className="text-2xl font-bold flex items-center space-x-2">
                  <Camera className="w-6 h-6 text-primary" />
                  <span>Face Enrollment</span>
                </h2>
              </div>
              <span className="text-xs font-bold px-3 py-1 bg-white/5 rounded-full border border-white/5">
                {Math.min(faceImages.length + 1, 4)} / 4
              </span>
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-center text-primary">
                {ANGLES[Math.min(currentAngleIndex, 3)].label}
              </h3>
              <p className="text-xs text-white/40 text-center">
                {ANGLES[Math.min(currentAngleIndex, 3)].sub}
              </p>
            </div>

            {faceImages.length < 4 ? (
              <CameraCapture 
                key={`angle-${currentAngleIndex}`}
                onCapture={onFaceCapture} 
                title={`Capture ${ANGLES[currentAngleIndex].label}`} 
              />
            ) : (
              <div className="h-[350px] flex flex-col items-center justify-center space-y-6 glass-card rounded-3xl border-dashed border-primary/20 p-6">
                <CheckCircle2 className="w-16 h-16 text-emerald-500 animate-bounce" />
                <div className="text-center">
                  <h4 className="font-bold text-lg">All Samples Collected</h4>
                  <p className="text-sm text-white/40">Your biometric samples are ready for processing</p>
                </div>
                
                {!loading && (
                  <div className="flex flex-col w-full space-y-3">
                    <button 
                      onClick={() => onFaceCapture(faceImages[3])} 
                      className="btn-primary w-full py-3 text-xs flex items-center justify-center space-x-2"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Finalize and Submit</span>
                    </button>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => { setFaceImages([]); setCurrentAngleIndex(0); }}
                        className="btn-secondary py-3 text-[10px] uppercase tracking-widest font-bold flex items-center justify-center space-x-2"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Retake All</span>
                      </button>
                      <button 
                        onClick={() => router.push(isStandaloneFace ? '/student/dashboard' : '/')}
                        className="bg-white/5 hover:bg-white/10 border border-white/5 py-3 rounded-2xl text-[10px] uppercase tracking-widest font-bold flex items-center justify-center space-x-2 transition-all"
                      >
                        <ChevronLeft className="w-3 h-3" />
                        <span>Go Back</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {loading && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-[40px]">
                <RefreshCw className="w-12 h-12 text-primary animate-spin mb-4" />
                <p className="font-bold text-lg">Processing Vectors...</p>
                <p className="text-xs text-white/50">Averaging 4D face encodings</p>
              </div>
            )}

            {!loading && faceImages.length === 0 && (
              <button 
                onClick={completeRegistrationOnly}
                className="w-full py-3 text-xs text-white/30 hover:text-white transition-colors"
              >
                Skip face enrollment for now
              </button>
            )}
          </motion.div>
        )}

        {step === 'SUCCESS' && (
          <motion.div 
            key="success"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md glass-card p-12 rounded-[40px] text-center space-y-6"
          >
            <div className="mx-auto w-24 h-24 bg-primary/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-16 h-16 text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">{isTeacher ? 'Registration Complete' : (skippedFace ? 'Account Created' : 'Enrollment Complete')}</h1>
              <p className="text-white/50">
                {isTeacher 
                  ? 'Your teacher account has been created successfully. You can now access the dashboard.'
                  : (skippedFace 
                      ? 'Your account is ready, but you will need to enroll your face later to mark attendance.' 
                      : 'Your identity has been verified and registered on the cloud node.')
                }
              </p>
            </div>
            <button 
              onClick={() => router.push(isStandaloneFace ? '/student/dashboard' : '/login')}
              className="w-full btn-primary"
            >
              {isStandaloneFace ? 'Return to Dashboard' : 'Sign In to Portal'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
