'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
    User, Mail, Building2, ShieldCheck, Camera, Mic, CheckCircle2,
    AlertTriangle, RefreshCw, Save, UserPlus, Lock, Clock,
    BadgeCheck, Eye, Square, Volume2, Fingerprint, Sparkles,
    ChevronRight, X,
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

interface UserData {
    _id: string;
    fullName: string;
    email: string;
    role: string;
    department?: { name: string; code: string } | string;
    faceRegisteredAt?: string;
    voiceRegisteredAt?: string;
    faceImageUrl?: string;
    lastLogin?: string;
    createdAt?: string;
}

type ActiveSection = 'profile' | 'face' | 'voice' | 'security';


export default function TeacherProfilePage() {
    const [user, setUser] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState<ActiveSection>('profile');

    // Profile edit state
    const [editName, setEditName] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);

    // Face registration state
    const webcamRef = useRef<Webcam>(null);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [cameraError, setCameraError] = useState(false);
    const [registeringFace, setRegisteringFace] = useState(false);
    const [flashActive, setFlashActive] = useState(false);

    // Voice registration state
    const [isRecording, setIsRecording] = useState(false);
    const [audioBase64, setAudioBase64] = useState<string | null>(null);
    const [audioDuration, setAudioDuration] = useState(0);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [registeringVoice, setRegisteringVoice] = useState(false);

    // Password change state
    const [currentPwd, setCurrentPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [changingPwd, setChangingPwd] = useState(false);
    const [showPwds, setShowPwds] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const fetchUser = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/auth/me');
            if (res.success) {
                const u = res.data.user;
                setUser(u);
                setEditName(u.fullName);
            }
        } catch {
            toast.error('Failed to load profile');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchUser(); }, [fetchUser]);

    // ── Camera helpers ──
    const capturePhoto = useCallback(() => {
        const img = webcamRef.current?.getScreenshot();
        if (img) {
            setCapturedImage(img);
        }
    }, []);

    const retakePhoto = () => { setCapturedImage(null); setCameraError(false); };

    // ── Voice helpers ──
    const resetVoice = () => { setAudioUrl(null); setAudioBase64(null); setAudioDuration(0); setIsRecording(false); };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(stream);
            audioChunks.current = [];
            mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
            mr.onstop = async () => {
                const blob = new Blob(audioChunks.current, { type: 'audio/wav' });
                setAudioUrl(URL.createObjectURL(blob));
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => setAudioBase64(reader.result as string);
                stream.getTracks().forEach(t => t.stop());
            };
            mr.start();
            mediaRecorderRef.current = mr;
            setIsRecording(true);
            setAudioDuration(0);
            timerRef.current = setInterval(() => setAudioDuration(p => p + 1), 1000);
        } catch {
            toast.error('Microphone access denied');
        }
    };

    const stopRecording = () => {
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
    };

    useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

    // ── Handlers ──
    const handleSaveProfile = async () => {
        if (!editName.trim()) { toast.error('Name cannot be empty'); return; }
        setSavingProfile(true);
        try {
            const res = await fetchWithAuth('/auth/profile', {
                method: 'PATCH',
                body: JSON.stringify({ fullName: editName }),
            });
            if (res.success) {
                setUser(prev => prev ? { ...prev, fullName: editName } : prev);
                toast.success('Profile updated!');
            }
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Update failed');
        } finally {
            setSavingProfile(false);
        }
    };

    const handleRegisterFace = async () => {
        if (!capturedImage) return;
        setRegisteringFace(true);
        try {
            const res = await fetchWithAuth('/biometric/face/register', {
                method: 'POST',
                body: JSON.stringify({ faceImage: capturedImage }),
            });
            if (res.success) {
                toast.success('🎉 Face registered successfully!');
                setCapturedImage(null);
                await fetchUser();
            }
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Face registration failed');
            setCapturedImage(null);
        } finally {
            setRegisteringFace(false);
        }
    };

    const handleRegisterVoice = async () => {
        if (!audioBase64) { toast.error('Please record a voice sample first'); return; }
        setRegisteringVoice(true);
        try {
            const res = await fetchWithAuth('/biometric/voice/register', {
                method: 'POST',
                body: JSON.stringify({ voiceAudio: audioBase64 }),
            });
            if (res.success) {
                toast.success('🎤 Voice registered successfully!');
                resetVoice();
                await fetchUser();
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Voice registration failed';
            toast.error(msg);
            resetVoice();
        } finally {
            setRegisteringVoice(false);
        }
    };

    const handleChangePassword = async () => {
        if (!currentPwd || !newPwd || !confirmPwd) { toast.error('All password fields are required'); return; }
        if (newPwd !== confirmPwd) { toast.error('New passwords do not match'); return; }
        if (newPwd.length < 6) { toast.error('New password must be at least 6 characters'); return; }
        setChangingPwd(true);
        try {
            const res = await fetchWithAuth('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
            });
            if (res.success) {
                toast.success('🎉 Password changed successfully!');
                setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
            }
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to change password');
        } finally {
            setChangingPwd(false);
        }
    };

    // ── Helpers ──
    const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const fmtTime = (d?: string) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
    const getDeptName = () => {
        if (!user?.department) return '—';
        if (typeof user.department === 'string') return user.department;
        return user.department.name || '—';
    };

    const SECTIONS: { id: ActiveSection; icon: React.ReactNode; label: string; desc: string }[] = [
        { id: 'profile', icon: <User className="w-5 h-5" />, label: 'Profile Info', desc: 'Name, email, department' },
        { id: 'face', icon: <Eye className="w-5 h-5" />, label: 'Face Registration', desc: 'Biometric face setup' },
        { id: 'voice', icon: <Mic className="w-5 h-5" />, label: 'Voice Registration', desc: 'Voice biometric setup' },
        { id: 'security', icon: <Lock className="w-5 h-5" />, label: 'Account & Security', desc: 'Login history, status' },
    ];

    if (loading) return (
        <DashboardLayout>
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                    <p className="text-white/40 text-sm">Loading profile…</p>
                </div>
            </div>
        </DashboardLayout>
    );

    return (
        <DashboardLayout>
            <div className="space-y-8 max-w-5xl mx-auto">

                {/* ── Page Header ── */}
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-gradient">Profile & Settings</h1>
                    <p className="text-white/40 text-sm font-medium mt-1">Manage your biometric data, profile info, and account settings.</p>
                </div>

                {/* ── Profile Hero Card ── */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden rounded-[36px] glass-card p-8 border-white/8"
                >
                    <div className="absolute top-0 left-1/3 w-64 h-20 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                        {/* Avatar */}
                        <div className="relative">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl font-black text-white shadow-xl shadow-indigo-500/20">
                                {user?.fullName?.charAt(0)?.toUpperCase()}
                            </div>
                            {user?.faceRegisteredAt && (
                                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full border-2 border-background flex items-center justify-center">
                                    <ShieldCheck className="w-3 h-3 text-white" />
                                </div>
                            )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 space-y-1">
                            <h2 className="text-2xl font-black">{user?.fullName}</h2>
                            <p className="text-white/40 text-sm">{user?.email}</p>
                            <div className="flex flex-wrap gap-2 pt-1">
                                <span className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-bold">{user?.role}</span>
                                {getDeptName() !== '—' && (
                                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/40 text-xs">{getDeptName()}</span>
                                )}
                                {user?.faceRegisteredAt && (
                                    <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center gap-1">
                                        <BadgeCheck className="w-3 h-3" /> Face Verified
                                    </span>
                                )}
                                {user?.voiceRegisteredAt && (
                                    <span className="px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-bold flex items-center gap-1">
                                        <Mic className="w-3 h-3" /> Voice Verified
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* ── Main grid: Sidebar + Content ── */}
                <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">

                    {/* Sidebar */}
                    <nav className="space-y-2">
                        {SECTIONS.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setActiveSection(s.id)}
                                className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all text-left border ${activeSection === s.id
                                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                                    : 'border-transparent hover:bg-white/5 text-white/50 hover:text-white/80'
                                    }`}
                            >
                                <span className={activeSection === s.id ? 'text-indigo-400' : 'text-white/30'}>{s.icon}</span>
                                <div>
                                    <p className="text-sm font-bold leading-tight">{s.label}</p>
                                    <p className="text-[10px] text-white/30">{s.desc}</p>
                                </div>
                                {activeSection === s.id && <ChevronRight className="w-4 h-4 ml-auto text-indigo-400" />}
                            </button>
                        ))}
                    </nav>

                    {/* Content Panel */}
                    <div className="glass-card rounded-[32px] p-8 border-white/8 min-h-[480px]">
                        <AnimatePresence mode="wait">

                            {/* ════ PROFILE INFO ════ */}
                            {activeSection === 'profile' && (
                                <motion.div key="profile" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-6">
                                    <div className="flex items-center gap-3 pb-2 border-b border-white/6">
                                        <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20"><User className="w-5 h-5 text-indigo-400" /></div>
                                        <div><h3 className="font-black text-lg">Profile Information</h3><p className="text-xs text-white/40">Update your display name</p></div>
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Full Name</label>
                                            <input
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                className="input-field text-sm font-medium"
                                                placeholder="Enter your full name"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Email Address</label>
                                            <div className="input-field text-sm text-white/40 cursor-not-allowed flex items-center gap-2">
                                                <Mail className="w-4 h-4 text-white/20" />
                                                {user?.email}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Department</label>
                                            <div className="input-field text-sm text-white/40 cursor-not-allowed flex items-center gap-2">
                                                <Building2 className="w-4 h-4 text-white/20" />
                                                {getDeptName()}
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleSaveProfile}
                                        disabled={savingProfile || editName === user?.fullName}
                                        className="flex items-center gap-2 btn-primary px-6 py-3 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold"
                                    >
                                        {savingProfile ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                                        {savingProfile ? 'Saving…' : 'Save Changes'}
                                    </button>
                                </motion.div>
                            )}

                            {/* ════ FACE REGISTRATION ════ */}
                            {activeSection === 'face' && (
                                <motion.div key="face" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-6">
                                    <div className="flex items-center gap-3 pb-2 border-b border-white/6">
                                        <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20"><UserPlus className="w-5 h-5 text-violet-400" /></div>
                                        <div>
                                            <h3 className="font-black text-lg">Face Registration</h3>
                                            <p className="text-xs text-white/40">Capture your face for biometric attendance</p>
                                        </div>
                                        {user?.faceRegisteredAt && (
                                            <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-400">
                                                <BadgeCheck className="w-3.5 h-3.5" /> Registered
                                            </div>
                                        )}
                                    </div>

                                    {user?.faceRegisteredAt && (
                                        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-500/8 border border-emerald-500/15">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                                            <div>
                                                <p className="text-sm font-bold text-emerald-300">Face already registered</p>
                                                <p className="text-xs text-white/30">Registered on {fmtDate(user.faceRegisteredAt)}</p>
                                            </div>
                                            <span className="ml-auto text-xs text-white/30">Re-register below to update</span>
                                        </div>
                                    )}

                                    {/* Webcam */}
                                    <div className="relative w-full aspect-video rounded-3xl overflow-hidden bg-black/60 border border-white/10">
                                        {/* Webcam always mounted — hidden when photo captured */}
                                        <div style={{ display: capturedImage ? 'none' : 'block' }} className="w-full h-full">
                                            {cameraError ? (
                                                <div className="flex flex-col items-center justify-center h-full gap-3">
                                                    <AlertTriangle className="w-10 h-10 text-amber-400" />
                                                    <p className="text-sm text-white/50">Camera access denied</p>
                                                </div>
                                            ) : (
                                                <>
                                                    <Webcam
                                                        ref={webcamRef}
                                                        audio={false}
                                                        screenshotFormat="image/jpeg"
                                                        screenshotQuality={0.92}
                                                        forceScreenshotSourceSize
                                                        videoConstraints={{ facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }}
                                                        onUserMediaError={() => setCameraError(true)}
                                                        className="w-full h-full object-cover"
                                                        mirrored
                                                    />
                                                    {/* Face guide oval — static */}
                                                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                                        <div className="w-44 h-56 border-2 border-dashed border-violet-400/40 rounded-[100%]" />
                                                    </div>
                                                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent text-center">
                                                        <p className="text-xs text-white/60 font-medium">Center your face in the oval</p>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {/* Captured image preview */}
                                        {capturedImage && (
                                            <>
                                                <img src={capturedImage} alt="captured" className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center">
                                                    <div className="bg-emerald-500/20 rounded-full p-4 border-2 border-emerald-400/40">
                                                        <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Camera action buttons */}
                                    {!capturedImage ? (
                                        <button
                                            onClick={capturePhoto}
                                            disabled={cameraError}
                                            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-violet-500/20"
                                        >
                                            <Camera className="w-5 h-5" /> Capture Face
                                        </button>
                                    ) : (
                                        <div className="flex gap-3">
                                            <button onClick={retakePhoto} className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm transition-all">
                                                <X className="w-4 h-4 inline mr-1" />Retake
                                            </button>
                                            <button
                                                onClick={handleRegisterFace}
                                                disabled={registeringFace}
                                                className="flex-[2] flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-violet-500/20"
                                            >
                                                {registeringFace
                                                    ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                                                    : <><ShieldCheck className="w-5 h-5" />Save Face Data</>
                                                }
                                            </button>
                                        </div>
                                    )}

                                    <p className="text-center text-[11px] text-white/25">
                                        <Fingerprint className="w-3.5 h-3.5 inline mr-1" />
                                        Your face data is encrypted and stored securely.
                                    </p>
                                </motion.div>
                            )}

                            {/* ════ VOICE REGISTRATION ════ */}
                            {activeSection === 'voice' && (
                                <motion.div key="voice" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-6">
                                    <div className="flex items-center gap-3 pb-2 border-b border-white/6">
                                        <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20"><Mic className="w-5 h-5 text-purple-400" /></div>
                                        <div>
                                            <h3 className="font-black text-lg">Voice Registration</h3>
                                            <p className="text-xs text-white/40">Record your voice for dual biometric verification</p>
                                        </div>
                                        {user?.voiceRegisteredAt && (
                                            <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-400">
                                                <BadgeCheck className="w-3.5 h-3.5" /> Registered
                                            </div>
                                        )}
                                    </div>

                                    {user?.voiceRegisteredAt && (
                                        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-500/8 border border-emerald-500/15">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                                            <div>
                                                <p className="text-sm font-bold text-emerald-300">Voice already registered</p>
                                                <p className="text-xs text-white/30">Registered on {fmtDate(user.voiceRegisteredAt)}</p>
                                            </div>
                                            <span className="ml-auto text-xs text-white/30">Re-record below to update</span>
                                        </div>
                                    )}

                                    {/* Recording card */}
                                    <div className="rounded-3xl bg-white/3 border border-white/8 p-8 flex flex-col items-center gap-6">
                                        <Sparkles className="w-6 h-6 text-purple-400 mb-1" />
                                        <p className="text-sm text-white/40 text-center">Say a clear phrase in your normal voice.<br />Minimum 3 seconds recommended.</p>

                                        {!audioBase64 ? (
                                            <div className="flex flex-col items-center gap-4">
                                                <div className="relative">
                                                    <div className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 ${isRecording ? 'bg-purple-500/20 ring-4 ring-purple-500/20' : 'bg-white/5 border-2 border-white/10'}`}>
                                                        {isRecording ? (
                                                            <motion.button
                                                                initial={{ scale: 0 }} animate={{ scale: 1 }}
                                                                onClick={stopRecording}
                                                                className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 hover:bg-red-400 transition-colors"
                                                            >
                                                                <Square className="w-8 h-8 text-white fill-white" />
                                                            </motion.button>
                                                        ) : (
                                                            <motion.button
                                                                initial={{ scale: 0 }} animate={{ scale: 1 }}
                                                                onClick={startRecording}
                                                                className="w-20 h-20 bg-purple-600 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/30 hover:bg-purple-500 transition-colors"
                                                            >
                                                                <Mic className="w-8 h-8 text-white" />
                                                            </motion.button>
                                                        )}
                                                    </div>
                                                    {isRecording && (
                                                        <div className="absolute inset-0 rounded-full border-2 border-purple-500/40 animate-ping pointer-events-none" />
                                                    )}
                                                </div>

                                                {isRecording ? (
                                                    <div className="flex flex-col items-center gap-2">
                                                        <div className="flex items-end gap-1 h-8">
                                                            {[1, 2, 3, 4, 5, 6, 7].map(n => (
                                                                <motion.div
                                                                    key={n}
                                                                    className="w-1.5 bg-purple-400 rounded-full"
                                                                    animate={{ height: [6, 22 + (n % 3) * 8, 6] }}
                                                                    transition={{ duration: 0.6, repeat: Infinity, delay: n * 0.08 }}
                                                                />
                                                            ))}
                                                        </div>
                                                        <span className="font-mono text-purple-400 font-bold text-base">
                                                            00:{audioDuration.toString().padStart(2, '0')}
                                                        </span>
                                                        <p className="text-xs text-white/30">Recording… tap ■ to stop</p>
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-white/40">Tap the microphone to start recording</p>
                                                )}
                                            </div>
                                        ) : (
                                            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-4">
                                                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                                                    <Volume2 className="w-5 h-5 text-emerald-400" />
                                                    <div>
                                                        <p className="text-sm font-bold text-emerald-400">Voice Captured</p>
                                                        <p className="text-xs text-white/40">{audioDuration}s · Ready to register</p>
                                                    </div>
                                                    <button onClick={resetVoice} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/40 transition-all">
                                                        <RefreshCw className="w-3 h-3" /> Redo
                                                    </button>
                                                </div>
                                                {audioUrl && (
                                                    <audio controls src={audioUrl} className="w-full rounded-xl opacity-60" />
                                                )}
                                            </motion.div>
                                        )}
                                    </div>

                                    {audioBase64 && (
                                        <button
                                            onClick={handleRegisterVoice}
                                            disabled={registeringVoice}
                                            className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-purple-500/20"
                                        >
                                            {registeringVoice
                                                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Registering…</>
                                                : <><ShieldCheck className="w-5 h-5" />Register Voice</>
                                            }
                                        </button>
                                    )}
                                </motion.div>
                            )}

                            {/* ════ SECURITY ════ */}
                            {activeSection === 'security' && (
                                <motion.div key="security" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-6">
                                    <div className="flex items-center gap-3 pb-2 border-b border-white/6">
                                        <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20"><Lock className="w-5 h-5 text-blue-400" /></div>
                                        <div><h3 className="font-black text-lg">Account & Security</h3><p className="text-xs text-white/40">Account status and activity</p></div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {[
                                            { label: 'Account Role', value: user?.role || '—', icon: <User className="w-4 h-4 text-indigo-400" />, color: 'bg-indigo-500/10 border-indigo-500/20' },
                                            { label: 'Last Login', value: `${fmtDate(user?.lastLogin)} · ${fmtTime(user?.lastLogin)}`, icon: <Clock className="w-4 h-4 text-blue-400" />, color: 'bg-blue-500/10 border-blue-500/20' },
                                            { label: 'Face Biometric', value: user?.faceRegisteredAt ? `Registered ${fmtDate(user.faceRegisteredAt)}` : 'Not registered', icon: <Fingerprint className="w-4 h-4 text-violet-400" />, color: user?.faceRegisteredAt ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10' },
                                            { label: 'Voice Biometric', value: user?.voiceRegisteredAt ? `Registered ${fmtDate(user.voiceRegisteredAt)}` : 'Not registered', icon: <Mic className="w-4 h-4 text-purple-400" />, color: user?.voiceRegisteredAt ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10' },
                                            { label: 'Member Since', value: fmtDate(user?.createdAt), icon: <BadgeCheck className="w-4 h-4 text-emerald-400" />, color: 'bg-emerald-500/10 border-emerald-500/20' },
                                            { label: 'Account Status', value: 'Active', icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />, color: 'bg-emerald-500/10 border-emerald-500/20' },
                                        ].map((item, i) => (
                                            <div key={i} className={`p-4 rounded-2xl border ${item.color} space-y-2`}>
                                                <div className="flex items-center gap-2">{item.icon}<span className="text-[10px] font-black uppercase tracking-widest text-white/30">{item.label}</span></div>
                                                <p className="text-sm font-bold text-white/70">{item.value}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {/* ── Change Password ── */}
                                    <div className="space-y-4 pt-4 border-t border-white/6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-bold">Change Password</p>
                                                <p className="text-xs text-white/30 mt-0.5">Use a strong password of at least 6 characters</p>
                                            </div>
                                            <button
                                                onClick={() => setShowPwds(v => !v)}
                                                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20"
                                            >
                                                {showPwds ? 'Cancel' : 'Change Password'}
                                            </button>
                                        </div>
                                        {showPwds && (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Current Password</label>
                                                    <input
                                                        type="password"
                                                        value={currentPwd}
                                                        onChange={e => setCurrentPwd(e.target.value)}
                                                        placeholder="Enter current password"
                                                        className="input-field text-sm"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1.5">New Password</label>
                                                    <input
                                                        type="password"
                                                        value={newPwd}
                                                        onChange={e => setNewPwd(e.target.value)}
                                                        placeholder="Min 6 characters"
                                                        className="input-field text-sm"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Confirm New Password</label>
                                                    <input
                                                        type="password"
                                                        value={confirmPwd}
                                                        onChange={e => setConfirmPwd(e.target.value)}
                                                        placeholder="Repeat new password"
                                                        className="input-field text-sm"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleChangePassword}
                                                    disabled={changingPwd || !currentPwd || !newPwd || !confirmPwd}
                                                    className="flex items-center gap-2 btn-primary px-6 py-3 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold"
                                                >
                                                    {changingPwd
                                                        ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Changing…</>
                                                        : <><Lock className="w-4 h-4" />Update Password</>
                                                    }
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="px-4 py-3 rounded-2xl bg-white/3 border border-white/8 flex items-start gap-3">
                                        <AlertTriangle className="w-4 h-4 text-white/20 mt-0.5 shrink-0" />
                                        <p className="text-xs text-white/30 leading-relaxed">
                                            Biometric data is encrypted and cannot be viewed — only re-registered from the Face / Voice tabs.
                                        </p>
                                    </div>
                                </motion.div>
                            )}

                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
