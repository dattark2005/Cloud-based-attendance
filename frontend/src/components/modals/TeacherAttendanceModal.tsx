'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Variants } from 'framer-motion';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    CheckCircle2,
    Camera,
    AlertTriangle,
    Clock,
    ShieldCheck,
    UserPlus,
    Scan,
    Mic,
    Square,
    RefreshCw,
    ArrowLeft,
    Fingerprint,
    Volume2,
    Sparkles,
    BadgeCheck,
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

type ViewState =
    | 'loading'
    | 'already_marked'
    | 'hub'
    | 'register_face'
    | 'scan_face'
    | 'voice_face'
    | 'processing'
    | 'success';

interface TeacherAttendanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    initialView?: ViewState | null;
    lectureId?: string | null;
}

interface AttendanceRecord {
    _id: string;
    markedAt: string;
    confidenceScore: number | null;
    verificationMethod: string;
}

interface StatusData {
    marked: boolean;
    markedForLecture: boolean;
    record: AttendanceRecord | null;
    faceRegistered: boolean;
    voiceRegistered?: boolean;
}

/* â”€â”€â”€ Framer Motion variants â”€â”€â”€ */
const slideIn: Variants = {
    initial: { opacity: 0, x: 40 },
    animate: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 280, damping: 26 } },
    exit: { opacity: 0, x: -40, transition: { duration: 0.18 } },
};

const fadeUp: Variants = {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 24 } },
    exit: { opacity: 0, y: -18, transition: { duration: 0.15 } },
};

/* â”€â”€â”€ Option cards data â”€â”€â”€ */
const ALL_OPTIONS = [
    {
        id: 'register_face' as ViewState,
        icon: UserPlus,
        label: 'Register Face',
        subtitle: 'One-time biometric setup',
        gradient: 'from-violet-600 to-indigo-600',
        glow: 'shadow-violet-500/25',
        border: 'border-violet-500/20',
        bg: 'bg-violet-500/10',
        iconColor: 'text-violet-400',
        showWhen: 'face_not_registered', // only when face not registered
    },
    {
        id: 'scan_face' as ViewState,
        icon: Scan,
        label: 'Scan Face',
        subtitle: 'Quick & secure check-in',
        gradient: 'from-blue-600 to-cyan-500',
        glow: 'shadow-blue-500/25',
        border: 'border-blue-500/20',
        bg: 'bg-blue-500/10',
        iconColor: 'text-blue-400',
        showWhen: 'always',
    },
    {
        id: 'voice_face' as ViewState,
        icon: Mic,
        label: 'Voice & Face',
        subtitle: 'Dual biometric — max security',
        gradient: 'from-purple-600 to-pink-600',
        glow: 'shadow-purple-500/25',
        border: 'border-purple-500/20',
        bg: 'bg-purple-500/10',
        iconColor: 'text-purple-400',
        showWhen: 'voice_registered', // only when voice registered
    },
];

const TeacherAttendanceModal: React.FC<TeacherAttendanceModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    initialView = null,
    lectureId = null,
}) => {
    const [view, setView] = useState<ViewState>('loading');
    const [statusData, setStatusData] = useState<StatusData | null>(null);

    /* camera state */
    const webcamRef = React.useRef<Webcam>(null);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [cameraError, setCameraError] = useState(false);
    const [flashActive, setFlashActive] = useState(false);

    /* voice state */
    const [isRecording, setIsRecording] = useState(false);
    const [audioBase64, setAudioBase64] = useState<string | null>(null);
    const [audioDuration, setAudioDuration] = useState(0);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    /* ─── Fetch today's status (per-lecture when lectureId provided) ─── */
    const fetchStatus = useCallback(async () => {
        setView('loading');
        try {
            const query = lectureId ? `?lectureId=${lectureId}` : '';
            const res = await fetchWithAuth(`/teacher-attendance/status${query}`);
            if (res.success) {
                const data: StatusData = res.data;
                setStatusData(data);
                // Per-lecture check: only block if THIS lecture is already marked
                // If no lectureId, allow marking (teacher can always mark for a new lecture)
                const alreadyDone = lectureId ? data.markedForLecture : false;
                setView(alreadyDone ? 'already_marked' : 'hub');
            }
        } catch {
            toast.error('Failed to check attendance status');
            onClose();
        }
    }, [onClose, lectureId]);

    useEffect(() => {
        if (isOpen) {
            setCapturedImage(null);
            setCameraError(false);
            resetVoice();
            if (initialView) {
                // Skip the hub and go directly to the requested view
                setView('loading');
                fetchStatus().then(() => {
                    // fetchStatus sets view to 'hub' or 'already_marked';
                    // override to the requested sub-view only if not already marked
                    setView(prev => prev === 'hub' ? initialView : prev);
                });
            } else {
                fetchStatus();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialView]);

    /* â”€â”€â”€ Camera helpers â”€â”€â”€ */
    const capturePhoto = useCallback(() => {
        const img = webcamRef.current?.getScreenshot();
        if (img) {
            setCapturedImage(img);
        }
    }, []);

    const retakePhoto = () => { setCapturedImage(null); setCameraError(false); };

    /* Voice helpers */
    const resetVoice = () => {
        setAudioUrl(null);
        setAudioBase64(null);
        setAudioDuration(0);
        setIsRecording(false);
    };

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

    /* â”€â”€â”€ Submit helpers â”€â”€â”€ */
    const submitFaceAttendance = async () => {
        if (!capturedImage) return;
        setView('processing');
        try {
            const res = await fetchWithAuth('/teacher-attendance/mark', {
                method: 'POST',
                body: JSON.stringify({ faceImage: capturedImage, ...(lectureId ? { lectureId } : {}) }),
            });
            if (res.success) {
                setView('success');
                toast.success('âœ… Attendance marked successfully!');
                onSuccess?.();
                setTimeout(onClose, 2600);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'An error occurred';
            if (msg.includes('already marked')) {
                setView('already_marked');
                toast('Already marked for today!', { icon: '📋' });
                fetchStatus();
            } else if (msg.includes('not registered') || msg.includes('Face not registered') || msg.includes('invalid or corrupted')) {
                setStatusData(prev => prev ? { ...prev, faceRegistered: false } : prev);
                setCapturedImage(null);
                setView('hub');
                toast.error('Face not registered or corrupted — please re-register.', { duration: 5000 });
            } else {
                setCapturedImage(null);
                setView('scan_face');
                toast.error(msg || 'Verification failed. Try again.');
            }
        }
    };

    const submitVoiceFaceAttendance = async () => {
        if (!capturedImage) { toast.error('Please capture your face first.'); return; }
        setView('processing');
        try {
            const body: Record<string, string> = { faceImage: capturedImage };
            if (audioBase64) body.voiceAudio = audioBase64;
            if (lectureId) body.lectureId = lectureId;
            const res = await fetchWithAuth('/teacher-attendance/mark', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (res.success) {
                setView('success');
                toast.success('âœ… Dual biometric attendance marked!');
                onSuccess?.();
                setTimeout(onClose, 2600);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'An error occurred';
            setCapturedImage(null);
            resetVoice();
            setView('voice_face');
            toast.error(msg || 'Verification failed. Try again.');
        }
    };

    const submitRegisterFace = async () => {
        if (!capturedImage) return;
        setView('processing');
        try {
            const res = await fetchWithAuth('/teacher-attendance/register-face', {
                method: 'POST',
                body: JSON.stringify({ faceImage: capturedImage }),
            });
            if (res.success) {
                toast.success('🎉 Face registered! You can now mark attendance by scanning your face.');
                setCapturedImage(null);
                // Immediately update local statusData so the hub re-renders without Register Face card
                setStatusData(prev => prev ? { ...prev, faceRegistered: true } : prev);
                setView('hub');
                // Also re-fetch in background to get fully updated data
                fetchStatus();
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Registration failed';
            toast.error(msg || 'Face registration failed. Please try again.');
            setCapturedImage(null);
            setView('register_face');
        }
    };

    /* â”€â”€â”€ Formatting â”€â”€â”€ */
    const fmtTime = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    /* â”€â”€â”€ Back button â”€â”€â”€ */
    const goBack = () => {
        setCapturedImage(null);
        setCameraError(false);
        resetVoice();
        setView('hub');
    };

    if (!isOpen) return null;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    /*  Sub-views                                                 */
    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    /* Shared webcam view */
    const WebcamView = ({ onSubmit, submitLabel, submitColor = 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20' }: {
        onSubmit: () => void;
        submitLabel: string;
        submitColor?: string;
    }) => (
        <div className="space-y-5">
            <div className="relative w-full aspect-video rounded-3xl overflow-hidden bg-black/60 border border-white/10">
                {/* Webcam always mounted — hidden when photo captured */}
                <div style={{ display: capturedImage ? 'none' : 'block' }} className="w-full h-full">
                    {cameraError ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-3">
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
                            {/* Face oval guide — static, no pulse */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="w-44 h-56 border-2 border-dashed border-blue-400/40 rounded-[100%]" />
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

            {!capturedImage ? (
                <button
                    onClick={capturePhoto}
                    disabled={cameraError}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white py-4 rounded-2xl font-bold transition-colors shadow-lg shadow-blue-500/20"
                >
                    <Camera className="w-5 h-5" />
                    <span>Capture Face</span>
                </button>
            ) : (
                <div className="flex gap-3">
                    <button
                        onClick={retakePhoto}
                        className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm transition-colors"
                    >
                        Retake
                    </button>
                    <button
                        onClick={onSubmit}
                        className={`flex-[2] flex items-center justify-center gap-2 text-white py-4 rounded-2xl font-bold transition-all shadow-lg ${submitColor}`}
                    >
                        <CheckCircle2 className="w-5 h-5" />
                        <span>{submitLabel}</span>
                    </button>
                </div>
            )}
        </div>
    );

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    /*  Render                                                    */
    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/75 backdrop-blur-lg"
                        onClick={onClose}
                    />

                    {/* Modal card */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.93, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.93, y: 24 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                        className="relative z-10 w-full max-w-lg"
                    >
                        <div className="glass-card rounded-[40px] overflow-hidden border border-white/10 shadow-2xl shadow-black/50">

                            {/* â”€â”€ Modal Header â”€â”€ */}
                            <div className="relative px-8 pt-8 pb-5">
                                {/* Decorative glow */}
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-24 bg-gradient-to-b from-indigo-600/20 to-transparent rounded-full blur-2xl pointer-events-none" />

                                <div className="relative flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {/* Back button for sub-views */}
                                        {(view === 'register_face' || view === 'scan_face' || view === 'voice_face') && (
                                            <button
                                                onClick={goBack}
                                                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all mr-1"
                                            >
                                                <ArrowLeft className="w-4 h-4 text-white/60" />
                                            </button>
                                        )}
                                        <div className="p-2.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/20">
                                            <ShieldCheck className="w-5 h-5 text-indigo-400" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-black tracking-tight">Teacher Attendance</h2>
                                            <p className="text-[11px] text-white/40 font-medium">
                                                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                                            </p>
                                        </div>
                                    </div>

                                    <button
                                        onClick={onClose}
                                        className="p-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all"
                                    >
                                        <X className="w-4 h-4 text-white/60" />
                                    </button>
                                </div>
                            </div>

                            {/* â”€â”€ View content â”€â”€ */}
                            <div className="px-8 pb-8">
                                <AnimatePresence mode="wait">

                                    {/* â•â•â•â• LOADING â•â•â•â• */}
                                    {view === 'loading' && (
                                        <motion.div key="loading" {...fadeUp} className="flex flex-col items-center justify-center py-16 space-y-5">
                                            <div className="relative">
                                                <div className="w-16 h-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                                                <Fingerprint className="absolute inset-0 m-auto w-7 h-7 text-indigo-400" />
                                            </div>
                                            <p className="text-white/40 text-sm font-medium">Checking biometric statusâ€¦</p>
                                        </motion.div>
                                    )}

                                    {/* â•â•â•â• HUB â•â•â•â• */}
                                    {view === 'hub' && (
                                        <motion.div key="hub" {...fadeUp} className="space-y-5">
                                            {/* Section heading */}
                                            <div className="text-center pt-2 pb-1 space-y-1">
                                                <h3 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
                                                    Teacher Attendance Management
                                                </h3>
                                                <p className="text-xs text-white/40">Select a method to mark or register your attendance</p>
                                            </div>

                                            {/* Live time pill */}
                                            <div className="flex justify-center">
                                                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/8 text-xs text-white/50 font-mono">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                                                </div>
                                            </div>

                                            {/* Option cards — filtered by registration status */}
                                            <div className="grid grid-cols-1 gap-3 pt-1">
                                                {ALL_OPTIONS
                                                    .filter(opt => {
                                                        if (opt.showWhen === 'face_not_registered') return !statusData?.faceRegistered;
                                                        if (opt.showWhen === 'voice_registered') return !!statusData?.voiceRegistered;
                                                        return true; // 'always'
                                                    })
                                                    .map((opt, i) => {
                                                        const Icon = opt.icon;
                                                        return (
                                                            <motion.button
                                                                key={opt.id}
                                                                initial={{ opacity: 0, y: 18 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                transition={{ delay: i * 0.07, type: 'spring', stiffness: 280, damping: 24 }}
                                                                whileHover={{ scale: 1.02, y: -2 }}
                                                                whileTap={{ scale: 0.98 }}
                                                                onClick={() => {
                                                                    setCapturedImage(null);
                                                                    setCameraError(false);
                                                                    resetVoice();
                                                                    setView(opt.id);
                                                                }}
                                                                className={`group relative w-full flex items-center gap-5 p-5 rounded-[24px] border ${opt.border} ${opt.bg} hover:border-white/20 transition-all duration-300 shadow-lg ${opt.glow} hover:shadow-xl text-left overflow-hidden`}
                                                            >
                                                                {/* Gradient shimmer */}
                                                                <div className={`absolute inset-0 bg-gradient-to-r ${opt.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300 rounded-[24px]`} />

                                                                {/* Icon bubble */}
                                                                <div className={`relative shrink-0 w-14 h-14 rounded-2xl ${opt.bg} border ${opt.border} flex items-center justify-center`}>
                                                                    <Icon className={`w-7 h-7 ${opt.iconColor}`} />
                                                                </div>

                                                                {/* Text */}
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-black text-base text-white">{opt.label}</p>
                                                                    <p className="text-xs text-white/40 mt-0.5">{opt.subtitle}</p>
                                                                </div>

                                                                {/* Arrow indicator */}
                                                                <div className={`shrink-0 w-8 h-8 rounded-xl ${opt.bg} border ${opt.border} flex items-center justify-center group-hover:translate-x-1 transition-transform`}>
                                                                    <svg className={`w-4 h-4 ${opt.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                                    </svg>
                                                                </div>
                                                            </motion.button>
                                                        );
                                                    })}
                                            </div>

                                            {/* Re-register face link (shown only when face IS registered) */}
                                            {statusData?.faceRegistered && (
                                                <div className="pt-1 text-center">
                                                    <button
                                                        onClick={() => { setCapturedImage(null); setCameraError(false); setView('register_face'); }}
                                                        className="text-[11px] text-white/25 hover:text-violet-400 transition-colors underline underline-offset-2"
                                                    >
                                                        Re-register face
                                                    </button>
                                                </div>
                                            )}
                                        </motion.div>
                                    )}

                                    {/* â•â•â•â• REGISTER FACE â•â•â•â• */}
                                    {view === 'register_face' && (
                                        <motion.div key="register_face" {...slideIn} className="space-y-5">
                                            <div className="flex items-center gap-3 pb-1">
                                                <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
                                                    <UserPlus className="w-5 h-5 text-violet-400" />
                                                </div>
                                                <div>
                                                    <p className="font-black text-sm">Register Your Face</p>
                                                    <p className="text-[11px] text-white/40">Capture a clear front-facing photo</p>
                                                </div>
                                            </div>

                                            <WebcamView
                                                onSubmit={submitRegisterFace}
                                                submitLabel="Save Face Data"
                                                submitColor="bg-violet-600 hover:bg-violet-500 shadow-violet-500/20"
                                            />

                                            <p className="text-center text-[11px] text-white/30">
                                                Your face data is encrypted and stored securely on our servers.
                                            </p>
                                        </motion.div>
                                    )}

                                    {/* â•â•â•â• SCAN FACE â•â•â•â• */}
                                    {view === 'scan_face' && (
                                        <motion.div key="scan_face" {...slideIn} className="space-y-5">
                                            <div className="flex items-center gap-3 pb-1">
                                                <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                                                    <Scan className="w-5 h-5 text-blue-400" />
                                                </div>
                                                <div>
                                                    <p className="font-black text-sm">Face Scan Attendance</p>
                                                    <p className="text-[11px] text-white/40">Look straight at the camera</p>
                                                </div>
                                            </div>

                                            <WebcamView
                                                onSubmit={submitFaceAttendance}
                                                submitLabel="Mark Present"
                                                submitColor="bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                                            />
                                        </motion.div>
                                    )}

                                    {/* â•â•â•â• VOICE + FACE â•â•â•â• */}
                                    {view === 'voice_face' && (
                                        <motion.div key="voice_face" {...slideIn} className="space-y-5">
                                            <div className="flex items-center gap-3 pb-1">
                                                <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
                                                    <Sparkles className="w-5 h-5 text-purple-400" />
                                                </div>
                                                <div>
                                                    <p className="font-black text-sm">Voice &amp; Face Verification</p>
                                                    <p className="text-[11px] text-white/40">Dual biometric for maximum security</p>
                                                </div>
                                            </div>

                                            {/* Step indicators */}
                                            <div className="flex items-center gap-2">
                                                {[
                                                    { step: 1, label: 'Voice', done: !!audioBase64, icon: Mic },
                                                    { step: 2, label: 'Face', done: !!capturedImage, icon: Camera },
                                                ].map((s, i) => {
                                                    const SIcon = s.icon;
                                                    return (
                                                        <React.Fragment key={s.step}>
                                                            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${s.done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-white/40'}`}>
                                                                <SIcon className="w-3.5 h-3.5" />
                                                                <span>Step {s.step}: {s.label}</span>
                                                                {s.done && <CheckCircle2 className="w-3.5 h-3.5" />}
                                                            </div>
                                                            {i === 0 && <div className="flex-1 h-px bg-white/10" />}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>

                                            {/* Voice recorder section */}
                                            <div className="rounded-3xl bg-white/3 border border-white/8 p-5 space-y-4">
                                                <p className="text-[11px] text-white/40 font-bold uppercase tracking-widest">Step 1 â€” Voice Sample</p>

                                                {!audioBase64 ? (
                                                    <div className="flex flex-col items-center gap-4">
                                                        <div className="relative">
                                                            <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${isRecording ? 'bg-accent/20 ring-4 ring-accent/20' : 'bg-white/5 border border-white/10'}`}>
                                                                {isRecording ? (
                                                                    <motion.button
                                                                        initial={{ scale: 0 }}
                                                                        animate={{ scale: 1 }}
                                                                        onClick={stopRecording}
                                                                        className="w-16 h-16 bg-accent rounded-full flex items-center justify-center shadow-lg shadow-accent/30"
                                                                    >
                                                                        <Square className="w-7 h-7 text-white fill-white" />
                                                                    </motion.button>
                                                                ) : (
                                                                    <motion.button
                                                                        initial={{ scale: 0 }}
                                                                        animate={{ scale: 1 }}
                                                                        onClick={startRecording}
                                                                        className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/30 hover:bg-purple-500 transition-colors"
                                                                    >
                                                                        <Mic className="w-7 h-7 text-white" />
                                                                    </motion.button>
                                                                )}
                                                            </div>
                                                            {isRecording && (
                                                                <div className="absolute inset-0 rounded-full border-2 border-accent/40 animate-ping pointer-events-none" />
                                                            )}
                                                        </div>

                                                        {isRecording ? (
                                                            <div className="flex flex-col items-center gap-2">
                                                                <div className="flex items-end gap-1 h-8">
                                                                    {[1, 2, 3, 4, 5, 6, 7].map(n => (
                                                                        <motion.div
                                                                            key={n}
                                                                            className="w-1.5 bg-accent rounded-full"
                                                                            animate={{ height: [6, 20 + (n % 3) * 8, 6] }}
                                                                            transition={{ duration: 0.6, repeat: Infinity, delay: n * 0.08 }}
                                                                        />
                                                                    ))}
                                                                </div>
                                                                <span className="font-mono text-accent font-bold text-sm">
                                                                    00:{audioDuration.toString().padStart(2, '0')}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-white/40">Tap mic to record your voice</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                                                                <Volume2 className="w-5 h-5 text-emerald-400" />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-emerald-400">Voice Captured</p>
                                                                <p className="text-[11px] text-white/40">{audioDuration}s recorded</p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={resetVoice}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/50 transition-all"
                                                        >
                                                            <RefreshCw className="w-3 h-3" />
                                                            Redo
                                                        </button>
                                                    </motion.div>
                                                )}
                                            </div>

                                            {/* Face capture section */}
                                            <div className="rounded-3xl bg-white/3 border border-white/8 p-5 space-y-4">
                                                <p className="text-[11px] text-white/40 font-bold uppercase tracking-widest">Step 2 â€” Face Capture</p>
                                                <WebcamView
                                                    onSubmit={submitVoiceFaceAttendance}
                                                    submitLabel="Verify & Mark Present"
                                                    submitColor="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-purple-500/20"
                                                />
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* â•â•â•â• PROCESSING â•â•â•â• */}
                                    {view === 'processing' && (
                                        <motion.div key="processing" {...fadeUp} className="flex flex-col items-center justify-center py-16 space-y-6">
                                            <div className="relative">
                                                <div className="w-24 h-24 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                                                <ShieldCheck className="absolute inset-0 m-auto w-10 h-10 text-indigo-400" />
                                            </div>
                                            <div className="text-center space-y-2">
                                                <p className="font-black text-white/80 text-lg">Verifying Biometricsâ€¦</p>
                                                <p className="text-xs text-white/30">Please wait while we authenticate you</p>
                                            </div>
                                            <div className="flex gap-1.5">
                                                {[0, 0.15, 0.3].map((d, i) => (
                                                    <motion.div
                                                        key={i}
                                                        className="w-2 h-2 bg-indigo-500 rounded-full"
                                                        animate={{ opacity: [0.3, 1, 0.3] }}
                                                        transition={{ duration: 1, repeat: Infinity, delay: d }}
                                                    />
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* â•â•â•â• SUCCESS â•â•â•â• */}
                                    {view === 'success' && (
                                        <motion.div key="success" {...fadeUp} className="flex flex-col items-center justify-center py-12 space-y-6">
                                            <motion.div
                                                initial={{ scale: 0, rotate: -20 }}
                                                animate={{ scale: 1, rotate: 0 }}
                                                transition={{ type: 'spring', stiffness: 280, damping: 18 }}
                                                className="relative"
                                            >
                                                <div className="w-28 h-28 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center">
                                                    <CheckCircle2 className="w-14 h-14 text-emerald-400" />
                                                </div>
                                                <motion.div
                                                    className="absolute inset-0 rounded-full border-2 border-emerald-500/20"
                                                    animate={{ scale: [1, 1.4], opacity: [0.5, 0] }}
                                                    transition={{ duration: 1.2, repeat: Infinity }}
                                                />
                                            </motion.div>
                                            <div className="text-center space-y-2">
                                                <h3 className="text-2xl font-black text-emerald-400">Attendance Marked!</h3>
                                                <p className="text-white/40 text-sm">You are marked present for today</p>
                                                <div className="flex items-center justify-center gap-2 pt-1">
                                                    <Clock className="w-3.5 h-3.5 text-white/25" />
                                                    <p className="text-xs text-white/25 font-mono">
                                                        {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                                                <BadgeCheck className="w-4 h-4 text-emerald-400" />
                                                <span className="text-xs font-bold text-emerald-400">Biometric Verified</span>
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* â•â•â•â• ALREADY MARKED â•â•â•â• */}
                                    {view === 'already_marked' && statusData && (
                                        <motion.div key="already_marked" {...fadeUp} className="space-y-6">
                                            <div className="flex flex-col items-center py-8 space-y-5">
                                                <motion.div
                                                    initial={{ scale: 0 }}
                                                    animate={{ scale: 1 }}
                                                    transition={{ type: 'spring', stiffness: 280, damping: 18 }}
                                                    className="w-28 h-28 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center"
                                                >
                                                    <CheckCircle2 className="w-14 h-14 text-emerald-400" />
                                                </motion.div>
                                                <div className="text-center space-y-1">
                                                    <h3 className="text-2xl font-black text-emerald-400">Already Present!</h3>
                                                    <p className="text-white/40 text-sm">Attendance is recorded for today</p>
                                                </div>
                                            </div>

                                            {statusData.record && (
                                                <div className="bg-white/5 rounded-3xl p-5 space-y-4 border border-white/8">
                                                    <div className="flex items-center gap-4">
                                                        <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                                                            <Clock className="w-5 h-5 text-emerald-400" />
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-white/30">Marked At</p>
                                                            <p className="text-lg font-black">{fmtTime(statusData.record.markedAt)}</p>
                                                            <p className="text-xs text-white/40">{fmtDate(statusData.record.markedAt)}</p>
                                                        </div>
                                                    </div>

                                                    {statusData.record.confidenceScore !== null && (
                                                        <div className="flex items-center justify-between pt-3 border-t border-white/5">
                                                            <span className="text-xs text-white/30 font-medium">Face Confidence</span>
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                                                    <motion.div
                                                                        initial={{ width: 0 }}
                                                                        animate={{ width: `${Math.round(statusData.record.confidenceScore * 100)}%` }}
                                                                        transition={{ delay: 0.3, duration: 0.8 }}
                                                                        className="h-full bg-emerald-400 rounded-full"
                                                                    />
                                                                </div>
                                                                <span className="text-xs font-black text-emerald-400">
                                                                    {Math.round(statusData.record.confidenceScore * 100)}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {statusData.record.verificationMethod && (
                                                        <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                                            <span className="text-xs text-white/30 font-medium">Method</span>
                                                            <span className="text-xs font-bold text-white/60 capitalize px-3 py-1 rounded-full bg-white/5 border border-white/10">
                                                                {statusData.record.verificationMethod}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <button onClick={onClose} className="w-full btn-primary py-4 font-black">
                                                Done
                                            </button>
                                        </motion.div>
                                    )}

                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default TeacherAttendanceModal;




