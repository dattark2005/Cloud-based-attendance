'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
    User, Mail, Hash, Camera, Mic, Lock, ShieldCheck,
    CheckCircle2, AlertTriangle, StopCircle, RefreshCw,
    Save, Eye, EyeOff, MicOff, Loader2
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

type Tab = 'profile' | 'face' | 'voice' | 'security';

export default function StudentProfilePage() {
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<Tab>('profile');

    // Profile edit
    const [editName, setEditName] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);

    // Face registration
    const webcamRef = useRef<Webcam>(null);
    const [showCamera, setShowCamera] = useState(false);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [registeringFace, setRegisteringFace] = useState(false);

    // Voice registration
    const [isRecording, setIsRecording] = useState(false);
    const [audioBase64, setAudioBase64] = useState<string | null>(null);
    const [registeringVoice, setRegisteringVoice] = useState(false);
    const [audioDuration, setAudioDuration] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Password change
    const [currentPwd, setCurrentPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [changingPwd, setChangingPwd] = useState(false);
    const [showPwds, setShowPwds] = useState<Record<string, boolean>>({});

    // Load user
    const loadUser = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/auth/me');
            const u = res.data?.user;
            setUser(u);
            setEditName(u?.fullName || '');
        } catch {
            toast.error('Failed to load profile');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { loadUser(); }, [loadUser]);

    // ── Save profile name ──────────────────────────────────────────────────────
    const saveProfile = async () => {
        if (!editName.trim()) { toast.error('Name cannot be empty'); return; }
        setSavingProfile(true);
        try {
            await fetchWithAuth('/auth/profile', {
                method: 'PATCH',
                body: JSON.stringify({ fullName: editName.trim() }),
            });
            toast.success('Profile updated!');
            loadUser();
        } catch (err: any) {
            toast.error(err.message || 'Failed to update profile');
        } finally {
            setSavingProfile(false);
        }
    };

    // ── Face capture & register ────────────────────────────────────────────────
    const capturePhoto = () => {
        const img = webcamRef.current?.getScreenshot();
        if (img) setCapturedImage(img);
        else toast.error('Could not capture. Check camera.');
    };

    const registerFace = async () => {
        if (!capturedImage) { toast.error('Capture a photo first'); return; }
        setRegisteringFace(true);
        try {
            const res = await fetchWithAuth('/biometric/face/register', {
                method: 'POST',
                body: JSON.stringify({ faceImages: [capturedImage] }),
            });
            if (res.success) {
                toast.success('🎉 Face registered successfully!');
                setCapturedImage(null);
                setShowCamera(false);
                loadUser();
            }
        } catch (err: any) {
            toast.error(err.message || 'Face registration failed');
        } finally {
            setRegisteringFace(false);
        }
    };

    // ── Voice record & register ────────────────────────────────────────────────
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            audioChunksRef.current = [];
            recorder.ondataavailable = e => audioChunksRef.current.push(e.data);
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
                const reader = new FileReader();
                reader.onloadend = () => setAudioBase64(reader.result as string);
                reader.readAsDataURL(blob);
            };
            mediaRecorderRef.current = recorder;
            recorder.start();
            setIsRecording(true);
            setAudioDuration(0);
            timerRef.current = setInterval(() => setAudioDuration(d => d + 1), 1000);
            // Auto-stop at 6s
            setTimeout(() => stopRecording(), 6000);
        } catch {
            toast.error('Microphone access denied');
        }
    };

    const stopRecording = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
        setIsRecording(false);
    };

    const registerVoice = async () => {
        if (!audioBase64) { toast.error('Record a voice sample first'); return; }
        setRegisteringVoice(true);
        try {
            const res = await fetchWithAuth('/biometric/voice/register', {
                method: 'POST',
                body: JSON.stringify({ voiceAudio: audioBase64 }),
            });
            if (res.success) {
                toast.success(res.data?.mocked
                    ? '✅ Voice saved (AI offline – fallback mode)'
                    : '🎉 Voice registered successfully!');
                setAudioBase64(null);
                loadUser();
            }
        } catch (err: any) {
            toast.error(err.message || 'Voice registration failed');
        } finally {
            setRegisteringVoice(false);
        }
    };

    // ── Change password ────────────────────────────────────────────────────────
    const changePassword = async () => {
        if (!currentPwd || !newPwd || !confirmPwd) { toast.error('All fields required'); return; }
        if (newPwd !== confirmPwd) { toast.error('New passwords do not match'); return; }
        if (newPwd.length < 6) { toast.error('Password must be at least 6 characters'); return; }
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
        } catch (err: any) {
            toast.error(err.message || 'Failed to change password');
        } finally {
            setChangingPwd(false);
        }
    };

    const togglePwd = (field: string) => setShowPwds(p => ({ ...p, [field]: !p[field] }));
    const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

    const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: 'profile', label: 'My Profile', icon: <User className="w-4 h-4" /> },
        { id: 'face', label: 'Face ID', icon: <Camera className="w-4 h-4" /> },
        { id: 'voice', label: 'Voice ID', icon: <Mic className="w-4 h-4" /> },
        { id: 'security', label: 'Security', icon: <Lock className="w-4 h-4" /> },
    ];

    if (loading) return (
        <DashboardLayout>
            <div className="flex items-center justify-center h-96">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        </DashboardLayout>
    );

    return (
        <DashboardLayout>
            <div className="max-w-3xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex items-center gap-5">
                    <div className="w-20 h-20 rounded-[24px] bg-gradient-to-tr from-primary to-secondary p-[2px]">
                        <div className="w-full h-full bg-background rounded-[23px] flex items-center justify-center text-3xl font-black">
                            {user?.fullName?.charAt(0)?.toUpperCase()}
                        </div>
                    </div>
                    <div>
                        <h1 className="text-4xl font-black tracking-tight text-gradient">{user?.fullName}</h1>
                        <p className="text-white/40 text-sm">{user?.email} · Student</p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 p-1 bg-white/5 rounded-2xl border border-white/5 w-fit">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeTab === tab.id
                                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                    : 'text-white/40 hover:text-white/70'
                                }`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <AnimatePresence mode="wait">

                    {/* ── PROFILE TAB ── */}
                    {activeTab === 'profile' && (
                        <motion.div key="profile" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] space-y-6">
                            <h2 className="text-xl font-bold flex items-center gap-2"><User className="w-5 h-5 text-primary" /> Personal Information</h2>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">Full Name</label>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="input-field w-full text-sm"
                                        placeholder="Your full name"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">Email</label>
                                    <input value={user?.email || '—'} disabled className="input-field w-full text-sm opacity-50 cursor-not-allowed" />
                                </div>
                                {user?.prn && (
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">PRN</label>
                                        <input value={user.prn} disabled className="input-field w-full text-sm opacity-50 cursor-not-allowed" />
                                    </div>
                                )}
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">Role</label>
                                    <input value={user?.role || '—'} disabled className="input-field w-full text-sm opacity-50 cursor-not-allowed" />
                                </div>
                            </div>

                            <div className="flex items-center gap-4 pt-2">
                                <button onClick={saveProfile} disabled={savingProfile}
                                    className="flex items-center gap-2 btn-primary px-6 py-3 disabled:opacity-40">
                                    {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Save Changes
                                </button>
                            </div>

                            {/* Biometric status chips */}
                            <div className="pt-4 border-t border-white/5 space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-white/30">Biometric Status</p>
                                <div className="flex flex-wrap gap-3">
                                    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold ${user?.faceRegistered ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' : 'border-amber-500/20 bg-amber-500/5 text-amber-400'}`}>
                                        {user?.faceRegistered ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                                        Face ID {user?.faceRegistered ? 'Enrolled' : 'Not Enrolled'}
                                    </div>
                                    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold ${user?.voiceRegisteredAt ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' : 'border-amber-500/20 bg-amber-500/5 text-amber-400'}`}>
                                        {user?.voiceRegisteredAt ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                                        Voice ID {user?.voiceRegisteredAt ? 'Enrolled' : 'Not Enrolled'}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ── FACE TAB ── */}
                    {activeTab === 'face' && (
                        <motion.div key="face" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold flex items-center gap-2"><Camera className="w-5 h-5 text-primary" /> Face ID Registration</h2>
                                {user?.faceRegistered && (
                                    <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase rounded-full">
                                        ✓ Enrolled · {fmtDate(user?.faceRegisteredAt)}
                                    </span>
                                )}
                            </div>

                            <p className="text-sm text-white/40">
                                Take a clear photo of your face. Make sure you are in good lighting with your face centered. This is used for AI-powered attendance marking.
                            </p>

                            {/* Camera / Preview */}
                            {!showCamera && !capturedImage && (
                                <button onClick={() => setShowCamera(true)}
                                    className="w-full py-6 rounded-[28px] border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 text-sm font-bold text-primary/70 transition-all flex items-center justify-center gap-3">
                                    <Camera className="w-5 h-5" /> Open Camera to Register Face
                                </button>
                            )}

                            {showCamera && !capturedImage && (
                                <div className="space-y-4">
                                    <div className="relative rounded-[28px] overflow-hidden aspect-video bg-black border border-white/10">
                                        <Webcam ref={webcamRef} audio={false} screenshotFormat="image/jpeg"
                                            className="w-full h-full object-cover"
                                            videoConstraints={{ facingMode: 'user' }} />
                                        {/* Face guide box */}
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <div className="w-48 h-64 border-2 border-primary/50 rounded-full opacity-60" />
                                        </div>
                                        <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-primary/60 rounded-tl-xl" />
                                        <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-primary/60 rounded-tr-xl" />
                                        <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-primary/60 rounded-bl-xl" />
                                        <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-primary/60 rounded-br-xl" />
                                    </div>
                                    <div className="flex gap-3">
                                        <button onClick={capturePhoto} className="flex-1 py-4 bg-primary hover:bg-primary/80 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                            <Camera className="w-4 h-4" /> Capture Photo
                                        </button>
                                        <button onClick={() => setShowCamera(false)} className="px-5 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold transition-all">Cancel</button>
                                    </div>
                                </div>
                            )}

                            {capturedImage && (
                                <div className="space-y-4">
                                    <div className="relative rounded-[28px] overflow-hidden aspect-video bg-black border border-emerald-500/20">
                                        <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
                                        <div className="absolute top-4 right-4 bg-emerald-500/80 backdrop-blur rounded-full p-2">
                                            <CheckCircle2 className="w-5 h-5 text-white" />
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <button onClick={registerFace} disabled={registeringFace}
                                            className="flex-1 py-4 bg-primary hover:bg-primary/80 disabled:opacity-40 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                            {registeringFace ? <><Loader2 className="w-4 h-4 animate-spin" />Registering…</> : <><ShieldCheck className="w-4 h-4" />Register This Photo</>}
                                        </button>
                                        <button onClick={() => { setCapturedImage(null); setShowCamera(true); }}
                                            className="px-5 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold transition-all flex items-center gap-2">
                                            <RefreshCw className="w-4 h-4" /> Retake
                                        </button>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* ── VOICE TAB ── */}
                    {activeTab === 'voice' && (
                        <motion.div key="voice" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] border border-violet-500/10 space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold flex items-center gap-2"><Mic className="w-5 h-5 text-violet-400" /> Voice ID Registration</h2>
                                {user?.voiceRegisteredAt && (
                                    <span className="px-3 py-1 bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-black uppercase rounded-full">
                                        ✓ Enrolled · {fmtDate(user?.voiceRegisteredAt)}
                                    </span>
                                )}
                            </div>

                            <div className="p-5 rounded-2xl bg-violet-500/8 border border-violet-500/15">
                                <p className="text-[10px] font-black uppercase tracking-widest text-violet-400/60 mb-1">Say this phrase clearly:</p>
                                <p className="text-2xl font-bold text-violet-100">"My name is present today"</p>
                            </div>

                            {/* Record button */}
                            <div className="space-y-4">
                                {isRecording && (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
                                            <p className="text-sm font-bold text-rose-400">Recording… {audioDuration}s / 6s</p>
                                        </div>
                                        <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                                            <motion.div className="h-full bg-violet-500 rounded-full"
                                                style={{ width: `${(audioDuration / 6) * 100}%` }} />
                                        </div>
                                        <div className="flex items-center justify-center gap-1 py-2">
                                            {[...Array(10)].map((_, i) => (
                                                <motion.div key={i}
                                                    animate={{ scaleY: [0.3, 1, 0.3] }}
                                                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.07 }}
                                                    className="w-2 bg-violet-400 rounded-full" style={{ height: 24 }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <button onClick={isRecording ? stopRecording : startRecording}
                                    className={`w-full py-5 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 ${isRecording ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse' : 'bg-violet-600 hover:bg-violet-500 text-white'}`}>
                                    {isRecording ? <><StopCircle className="w-5 h-5" /> Stop Recording</> : <><Mic className="w-5 h-5" /> Start Recording (6s)</>}
                                </button>

                                {audioBase64 && !isRecording && (
                                    <div className="space-y-3 pt-2">
                                        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                            <span className="text-sm text-emerald-400 font-medium">Recording ready — {audioDuration}s captured</span>
                                        </div>
                                        <div className="flex gap-3">
                                            <button onClick={registerVoice} disabled={registeringVoice}
                                                className="flex-1 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                                {registeringVoice ? <><Loader2 className="w-4 h-4 animate-spin" />Registering…</> : <><ShieldCheck className="w-4 h-4" />Register Voice</>}
                                            </button>
                                            <button onClick={() => { setAudioBase64(null); setAudioDuration(0); }}
                                                className="px-5 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold transition-all">
                                                Re-Record
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* ── SECURITY TAB ── */}
                    {activeTab === 'security' && (
                        <motion.div key="security" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] space-y-6">
                            <h2 className="text-xl font-bold flex items-center gap-2"><Lock className="w-5 h-5 text-indigo-400" /> Account Security</h2>

                            <div className="space-y-4">
                                {[
                                    { key: 'current', label: 'Current Password', value: currentPwd, onChange: setCurrentPwd },
                                    { key: 'new', label: 'New Password', value: newPwd, onChange: setNewPwd },
                                    { key: 'confirm', label: 'Confirm New Password', value: confirmPwd, onChange: setConfirmPwd },
                                ].map(field => (
                                    <div key={field.key}>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-1.5">{field.label}</label>
                                        <div className="relative">
                                            <input
                                                type={showPwds[field.key] ? 'text' : 'password'}
                                                value={field.value}
                                                onChange={e => field.onChange(e.target.value)}
                                                placeholder={field.key === 'new' ? 'Min 6 characters' : '••••••••'}
                                                className="input-field text-sm w-full pr-12"
                                            />
                                            <button onClick={() => togglePwd(field.key)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                                                {showPwds[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button onClick={changePassword} disabled={changingPwd || !currentPwd || !newPwd || !confirmPwd}
                                className="flex items-center gap-2 btn-primary px-6 py-3 disabled:opacity-40 disabled:cursor-not-allowed">
                                {changingPwd ? <><Loader2 className="w-4 h-4 animate-spin" />Changing…</> : <><Lock className="w-4 h-4" />Update Password</>}
                            </button>

                            <div className="pt-4 border-t border-white/5 flex items-start gap-3 p-4 rounded-2xl bg-white/3">
                                <ShieldCheck className="w-4 h-4 text-primary/40 mt-0.5 shrink-0" />
                                <p className="text-xs text-white/30">Your password is hashed and stored securely. Biometric data is encrypted and only used for attendance verification.</p>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        </DashboardLayout>
    );
}
