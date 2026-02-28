'use client';

import React, { useState, useEffect, useCallback, use, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Camera, Upload, CheckCircle2, XCircle,
    Clock, Calendar, BookOpen, BadgeCheck, AlertCircle,
    ChevronRight, Shield, Edit3, Users, Loader2,
    UserCheck, UserX, ShieldCheck, RefreshCw, ScanLine,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import DashboardLayout from '@/components/DashboardLayout';
import { fetchWithAuth } from '@/lib/api';
import TeacherAttendanceModal from '@/components/modals/TeacherAttendanceModal';

function formatDateTime(dateStr: string) {
    const d = new Date(dateStr);
    return {
        date: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    };
}

function getStatusColor(status: string) {
    switch (status) {
        case 'ONGOING': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
        case 'SCHEDULED': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
        case 'COMPLETED': return 'bg-white/10 text-white/40 border-white/10';
        case 'CANCELLED': return 'bg-red-500/15 text-red-400 border-red-500/30';
        default: return 'bg-white/5 text-white/30 border-white/5';
    }
}

export default function LectureDetailPage({
    params,
}: {
    params: Promise<{ sectionId: string; lectureId: string }>;
}) {
    const { sectionId, lectureId } = use(params);
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    // Callback ref: fires the instant <video> mounts, guaranteed to have the DOM node
    const videoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
        if (node && streamRef.current) {
            node.srcObject = streamRef.current;
            node.play().catch(() => { /* autoplay policy — user interaction already happened */ });
        }
    }, []);

    /* State */
    const [lecture, setLecture] = useState<any>(null);
    const [section, setSection] = useState<any>(null);
    const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
    const [allStudents, setAllStudents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Teacher attendance
    const [teacherMarked, setTeacherMarked] = useState<boolean | null>(null);
    const [teacherMarkedAt, setTeacherMarkedAt] = useState<string | null>(null);
    const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);

    // Photo / Camera
    const [photoMode, setPhotoMode] = useState<'idle' | 'camera' | 'preview'>('idle');
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingResult, setProcessingResult] = useState<{ detected: number; marked: number } | null>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

    // Manual edit
    const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    /* ─── Load data ─── */
    const loadLectureData = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`/attendance/status/${lectureId}`);
            if (res.success) {
                setLecture(res.data.lecture);
                setAttendanceRecords(res.data.attendanceRecords || []);
                const sectionData = res.data.lecture?.sectionId;
                setSection(sectionData);
                setAllStudents(sectionData?.students || []);
            }
        } catch {
            toast.error('Failed to load lecture');
        } finally {
            setLoading(false);
        }
    }, [lectureId]);

    const checkTeacherAttendance = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`/teacher-attendance/status?lectureId=${lectureId}`);
            if (res.success) {
                // Use markedForLecture (per-lecture) not marked (per-day)
                setTeacherMarked(res.data.markedForLecture ?? res.data.marked ?? false);
                setTeacherMarkedAt(res.data.record?.markedAt || null);
            }
        } catch { /* non-critical */ }
    }, []);

    useEffect(() => {
        loadLectureData();
        checkTeacherAttendance();
        return () => stopCamera();
    }, [loadLectureData, checkTeacherAttendance]);

    // Safety net: if AnimatePresence delays the video mount slightly beyond the callback ref,
    // retry attaching the stream every 50ms until the element appears.
    useEffect(() => {
        if (photoMode !== 'camera') return;
        let attempts = 0;
        const interval = setInterval(() => {
            const video = document.querySelector<HTMLVideoElement>('video[data-camera]');
            if (video && streamRef.current && !video.srcObject) {
                video.srcObject = streamRef.current;
                video.play().catch(() => { });
                clearInterval(interval);
            }
            if (++attempts > 40) clearInterval(interval); // give up after 2 s
        }, 50);
        return () => clearInterval(interval);
    }, [photoMode]);

    /* ─── Camera ─── */
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            streamRef.current = stream;   // store in ref (stable)
            setCameraStream(stream);       // also store in state for stopCamera
            setPhotoMode('camera');        // triggers render → then the useEffect above wires the video
        } catch (err) {
            console.error('Camera error:', err);
            toast.error('Camera access denied. Please allow camera permissions and ensure you are on HTTPS or localhost.');
        }
    };

    const stopCamera = () => {
        const s = streamRef.current;
        if (s) {
            s.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            setCameraStream(null);
        }
    };

    const capturePhoto = () => {
        // Find the video element via the DOM since we use callback ref
        const video = document.querySelector<HTMLVideoElement>('video[data-camera]');
        if (!video || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        stopCamera();
        setCapturedImage(dataUrl);
        setPhotoMode('preview');
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            setCapturedImage(ev.target?.result as string);
            setPhotoMode('preview');
        };
        reader.readAsDataURL(file);
    };

    /* ─── Process Photo ─── */
    const processPhoto = async () => {
        if (!capturedImage) return;
        setIsProcessing(true);
        setProcessingResult(null);
        try {
            const res = await fetchWithAuth('/attendance/classroom-photo', {
                method: 'POST',
                body: JSON.stringify({ lectureId, faceImage: capturedImage }),
            });
            if (res.success) {
                const { totalDetected, markedCount } = res.data;
                setProcessingResult({ detected: totalDetected, marked: markedCount });
                toast.success(`Marked ${markedCount} student${markedCount !== 1 ? 's' : ''} present!`);
                setCapturedImage(null);
                setPhotoMode('idle');
                loadLectureData();
            } else {
                toast.error(res.message || 'Processing failed');
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to process photo');
        } finally {
            setIsProcessing(false);
        }
    };

    /* ─── Manual override ─── */
    const updateAttendance = async (studentId: string, status: 'PRESENT' | 'ABSENT') => {
        setUpdatingId(studentId);
        try {
            const res = await fetchWithAuth(`/attendance/student/${studentId}/lecture/${lectureId}`, {
                method: 'PUT',
                body: JSON.stringify({ status }),
            });
            if (res.success) {
                toast.success(status === 'PRESENT' ? '✅ Marked Present' : '❌ Marked Absent');
                setEditingStudentId(null);
                loadLectureData();
            } else {
                toast.error(res.message || 'Update failed');
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to update');
        } finally {
            setUpdatingId(null);
        }
    };

    /* ─── Derived state ─── */
    const presentIds = new Set(attendanceRecords.map((r: any) => r.studentId?._id?.toString() || r.studentId?.toString()));
    const presentStudents = allStudents.filter((s: any) => presentIds.has(s._id?.toString()));
    const absentStudents = allStudents.filter((s: any) => !presentIds.has(s._id?.toString()));
    const presentCount = presentStudents.length;
    const totalCount = allStudents.length;
    const attendanceRate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

    /* ─── Loading ─── */
    if (loading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
            </DashboardLayout>
        );
    }

    const start = lecture?.scheduledStart ? formatDateTime(lecture.scheduledStart) : null;
    const end = lecture?.scheduledEnd ? formatDateTime(lecture.scheduledEnd) : null;
    const isActive = lecture?.status === 'ONGOING' || lecture?.status === 'SCHEDULED';

    return (
        <DashboardLayout>
            <div className="space-y-8">

                {/* ── Back ── */}
                <Link
                    href={`/teacher/classroom/${sectionId}`}
                    className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Classroom
                </Link>

                {/* ── Lecture Header ── */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card p-8 rounded-[32px] border-white/8 space-y-4"
                >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                <BookOpen className="w-7 h-7 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-gradient">
                                    {lecture?.topic}
                                </h1>
                                <p className="text-white/40 text-sm mt-1">
                                    {section?.courseId?.courseName} · {section?.sectionName}
                                </p>
                            </div>
                        </div>
                        <span className={`text-[11px] font-black uppercase tracking-widest px-4 py-2 rounded-full border self-start ${getStatusColor(lecture?.status)}`}>
                            {lecture?.status}
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-4 pt-2">
                        {start && (
                            <>
                                <div className="flex items-center gap-2 text-sm text-white/40">
                                    <Calendar className="w-4 h-4" />
                                    <span>{start.date}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-white/40">
                                    <Clock className="w-4 h-4" />
                                    <span>{start.time} – {end?.time}</span>
                                </div>
                            </>
                        )}
                        {lecture?.sectionId?.roomNumber && (
                            <div className="text-sm text-white/40">📍 {lecture.sectionId.roomNumber}</div>
                        )}
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-4 pt-2">
                        {[
                            { label: 'Total', value: totalCount, color: 'text-white' },
                            { label: 'Present', value: presentCount, color: 'text-emerald-400' },
                            { label: 'Absent', value: absentStudents.length, color: 'text-red-400' },
                        ].map(stat => (
                            <div key={stat.label} className="glass-card p-4 rounded-2xl text-center">
                                <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
                                <p className="text-[10px] text-white/30 uppercase tracking-widest mt-1">{stat.label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Attendance Rate Bar */}
                    {totalCount > 0 && (
                        <div className="space-y-1">
                            <div className="flex justify-between text-[11px] text-white/30">
                                <span>Attendance Rate</span>
                                <span className="font-bold text-emerald-400">{attendanceRate}%</span>
                            </div>
                            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${attendanceRate}%` }}
                                    transition={{ delay: 0.4, duration: 0.8, ease: 'easeOut' }}
                                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                                />
                            </div>
                        </div>
                    )}
                </motion.div>

                {/* ── Teacher's Own Attendance ── */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="glass-card p-6 rounded-[28px] border-white/8 flex items-center justify-between gap-4"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
                            <ShieldCheck className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div>
                            <p className="font-bold text-sm">Your Attendance</p>
                            <p className="text-xs text-white/40">
                                {teacherMarked === null
                                    ? 'Checking...'
                                    : teacherMarked
                                        ? `Marked present at ${teacherMarkedAt ? new Date(teacherMarkedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''}`
                                        : 'Not yet marked for today'}
                            </p>
                        </div>
                    </div>
                    <AnimatePresence mode="wait">
                        {teacherMarked === true ? (
                            <motion.div
                                key="marked"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/15 border border-emerald-500/30"
                            >
                                <BadgeCheck className="w-4 h-4 text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-300">Present</span>
                            </motion.div>
                        ) : (
                            <motion.button
                                key="mark-btn"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                onClick={() => setIsAttendanceModalOpen(true)}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15 transition-all"
                            >
                                <AlertCircle className="w-4 h-4 text-amber-400" />
                                <span className="text-xs font-bold text-amber-300">Mark Now</span>
                                <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
                            </motion.button>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* ── Classroom Photo Attendance ── */}
                {isActive && (
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="glass-card p-8 rounded-[32px] border-white/8 space-y-6"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                                <ScanLine className="w-6 h-6 text-violet-400" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black">Mark Attendance via Photo</h2>
                                <p className="text-xs text-white/40 mt-0.5">Upload or capture a classroom photo. Our AI will recognize all students.</p>
                            </div>
                        </div>

                        {/* Photo UI */}
                        <AnimatePresence mode="wait">
                            {photoMode === 'idle' && (
                                <motion.div
                                    key="idle"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="grid sm:grid-cols-2 gap-4"
                                >
                                    {/* Camera */}
                                    <button
                                        onClick={startCamera}
                                        className="flex flex-col items-center justify-center gap-4 p-8 rounded-[24px] border-2 border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 transition-all group"
                                    >
                                        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-all">
                                            <Camera className="w-8 h-8 text-primary" />
                                        </div>
                                        <div className="text-center">
                                            <p className="font-bold text-sm">Use Camera</p>
                                            <p className="text-xs text-white/40 mt-1">Take a photo of the classroom</p>
                                        </div>
                                    </button>

                                    {/* Upload */}
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex flex-col items-center justify-center gap-4 p-8 rounded-[24px] border-2 border-dashed border-violet-500/30 hover:border-violet-500/60 hover:bg-violet-500/5 transition-all group"
                                    >
                                        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-500/20 transition-all">
                                            <Upload className="w-8 h-8 text-violet-400" />
                                        </div>
                                        <div className="text-center">
                                            <p className="font-bold text-sm">Upload Photo</p>
                                            <p className="text-xs text-white/40 mt-1">Pick an existing classroom photo</p>
                                        </div>
                                    </button>

                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileUpload}
                                    />
                                </motion.div>
                            )}

                            {photoMode === 'camera' && (
                                <motion.div
                                    key="camera"
                                    initial={{ opacity: 0, scale: 0.97 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.97 }}
                                    className="space-y-4"
                                >
                                    <div className="relative rounded-[24px] overflow-hidden bg-black">
                                        <video
                                            data-camera
                                            ref={videoCallbackRef}
                                            className="w-full h-full object-contain"
                                            style={{ maxHeight: '60vh', display: 'block' }}
                                            muted
                                            playsInline
                                            autoPlay
                                        />
                                        <div className="absolute inset-0 border-2 border-primary/40 rounded-[24px] pointer-events-none" />
                                    </div>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={capturePhoto}
                                            className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary-glow text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-primary/20"
                                        >
                                            <Camera className="w-5 h-5" /> Capture Photo
                                        </button>
                                        <button
                                            onClick={() => { stopCamera(); setPhotoMode('idle'); }}
                                            className="px-5 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm transition-all"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                    <canvas ref={canvasRef} className="hidden" />
                                </motion.div>
                            )}

                            {photoMode === 'preview' && capturedImage && (
                                <motion.div
                                    key="preview"
                                    initial={{ opacity: 0, scale: 0.97 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.97 }}
                                    className="space-y-4"
                                >
                                    <div className="relative rounded-[24px] overflow-hidden bg-black" style={{ maxHeight: '70vh' }}>
                                        <img
                                            src={capturedImage}
                                            alt="Classroom"
                                            className="w-full h-auto object-contain block"
                                            style={{ maxHeight: '70vh' }}
                                        />
                                        {isProcessing && (
                                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                                                <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                                                <p className="text-sm font-bold text-white animate-pulse">Analyzing faces…</p>
                                                <p className="text-xs text-white/40">AI is recognizing enrolled students</p>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={processPhoto}
                                            disabled={isProcessing}
                                            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {isProcessing ? (
                                                <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                                            ) : (
                                                <><ScanLine className="w-5 h-5" /> Analyse & Mark Attendance</>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => { setCapturedImage(null); setPhotoMode('idle'); }}
                                            disabled={isProcessing}
                                            className="px-5 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm transition-all disabled:opacity-40"
                                        >
                                            Retake
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Processing result banner */}
                        {processingResult && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20"
                            >
                                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                                <p className="text-sm text-emerald-300 font-medium">
                                    <span className="font-bold">{processingResult.detected}</span> face{processingResult.detected !== 1 ? 's' : ''} detected ·{' '}
                                    <span className="font-bold">{processingResult.marked}</span> student{processingResult.marked !== 1 ? 's' : ''} newly marked present
                                </p>
                                <button
                                    onClick={() => setProcessingResult(null)}
                                    className="ml-auto text-emerald-400/60 hover:text-emerald-400 transition-colors"
                                >
                                    ✕
                                </button>
                            </motion.div>
                        )}
                    </motion.div>
                )}

                {/* ── Student Attendance List ── */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="space-y-6"
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-black tracking-tight">Student Attendance</h2>
                        <button
                            onClick={loadLectureData}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/60 hover:text-white transition-all"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> Refresh
                        </button>
                    </div>

                    {allStudents.length === 0 ? (
                        <div className="glass-card p-10 rounded-[28px] text-center border-2 border-dashed border-white/5">
                            <Users className="w-10 h-10 text-white/10 mx-auto mb-3" />
                            <p className="text-white/30 text-sm">No students enrolled in this classroom.</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Present */}
                            {presentStudents.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                                        <UserCheck className="w-4 h-4" />
                                        Present ({presentStudents.length})
                                    </h3>
                                    <div className="space-y-2">
                                        {presentStudents.map((student: any, i: number) => {
                                            const record = attendanceRecords.find(r =>
                                                (r.studentId?._id?.toString() || r.studentId?.toString()) === student._id?.toString()
                                            );
                                            return (
                                                <motion.div
                                                    key={student._id}
                                                    initial={{ opacity: 0, x: -12 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: i * 0.04 }}
                                                    className="glass-card p-4 rounded-[20px] border-emerald-500/10 flex items-center justify-between gap-4"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-sm font-black text-emerald-400 shrink-0">
                                                            {student.fullName?.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-bold truncate">{student.fullName}</p>
                                                            <div className="flex items-center gap-3 mt-0.5">
                                                                <p className="text-[11px] text-white/40 truncate">{student.prn || student.email}</p>
                                                                {record && (
                                                                    <span className="text-[10px] text-white/25 font-mono">
                                                                        {record.verificationMethod === 'FACE' ? '🤖 AI' : '✏️ Manual'} · {new Date(record.markedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full uppercase tracking-widest">
                                                            Present
                                                        </span>
                                                        {isActive && (
                                                            <button
                                                                onClick={() => updateAttendance(student._id, 'ABSENT')}
                                                                disabled={updatingId === student._id}
                                                                className="p-2 rounded-xl bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 hover:border-red-500/30 transition-all disabled:opacity-40"
                                                                title="Mark Absent"
                                                            >
                                                                {updatingId === student._id
                                                                    ? <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin" />
                                                                    : <XCircle className="w-3.5 h-3.5 text-red-400/60 hover:text-red-400 transition-colors" />
                                                                }
                                                            </button>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Absent */}
                            {absentStudents.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="text-xs font-black text-red-400 uppercase tracking-widest flex items-center gap-2">
                                        <UserX className="w-4 h-4" />
                                        Absent ({absentStudents.length})
                                    </h3>
                                    <div className="space-y-2">
                                        {absentStudents.map((student: any, i: number) => (
                                            <motion.div
                                                key={student._id}
                                                initial={{ opacity: 0, x: -12 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: i * 0.04 }}
                                                className="glass-card p-4 rounded-[20px] border-red-500/5 flex items-center justify-between gap-4 opacity-70 hover:opacity-90 transition-all"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm font-black text-white/40 shrink-0">
                                                        {student.fullName?.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold truncate text-white/70">{student.fullName}</p>
                                                        <p className="text-[11px] text-white/30 truncate">{student.prn || student.email}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-[10px] font-black text-red-400/70 bg-red-500/5 border border-red-500/15 px-3 py-1.5 rounded-full uppercase tracking-widest">
                                                        Absent
                                                    </span>
                                                    {isActive && (
                                                        <button
                                                            onClick={() => updateAttendance(student._id, 'PRESENT')}
                                                            disabled={updatingId === student._id}
                                                            className="p-2 rounded-xl bg-emerald-500/5 hover:bg-emerald-500/15 border border-emerald-500/10 hover:border-emerald-500/30 transition-all disabled:opacity-40"
                                                            title="Mark Present"
                                                        >
                                                            {updatingId === student._id
                                                                ? <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                                                                : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/60 hover:text-emerald-400 transition-colors" />
                                                            }
                                                        </button>
                                                    )}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </motion.div>

            </div>

            <TeacherAttendanceModal
                isOpen={isAttendanceModalOpen}
                onClose={() => setIsAttendanceModalOpen(false)}
                onSuccess={() => {
                    setTeacherMarked(true);
                    setTeacherMarkedAt(new Date().toISOString());
                }}
                initialView={null}
                lectureId={lectureId}
            />
        </DashboardLayout>
    );
}
