'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Users, Copy, Calendar, Clock, Plus, Trash2,
    ShieldCheck, BookOpen, CheckCircle2, AlertCircle,
    BadgeCheck, Scan, Mic, UserPlus, CalendarDays, Zap,
    ChevronRight, Activity,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import DashboardLayout from '@/components/DashboardLayout';
import { fetchWithAuth } from '@/lib/api';
import TeacherAttendanceModal from '@/components/modals/TeacherAttendanceModal';
import ScheduleLectureModal from '@/components/modals/ScheduleLectureModal';

type AttendanceView = 'register_face' | 'scan_face' | 'voice_face' | null;

/* Attendance action cards shown inside classroom */
const ATTENDANCE_ACTIONS = [
    {
        id: 'register_face' as AttendanceView,
        icon: UserPlus,
        label: 'Register Face',
        subtitle: 'One-time biometric setup',
        gradient: 'from-violet-600 to-indigo-600',
        glow: 'shadow-violet-500/30',
        border: 'border-violet-500/20',
        bg: 'bg-violet-500/10',
        iconColor: 'text-violet-400',
        hoverBg: 'hover:bg-violet-500/15',
        pill: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
        pillText: 'Setup',
    },
    {
        id: 'scan_face' as AttendanceView,
        icon: Scan,
        label: 'Scan Face',
        subtitle: 'Quick & secure check-in',
        gradient: 'from-blue-600 to-cyan-500',
        glow: 'shadow-blue-500/30',
        border: 'border-blue-500/20',
        bg: 'bg-blue-500/10',
        iconColor: 'text-blue-400',
        hoverBg: 'hover:bg-blue-500/15',
        pill: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
        pillText: 'Fast',
    },
    {
        id: 'voice_face' as AttendanceView,
        icon: Mic,
        label: 'Voice & Face',
        subtitle: 'Dual biometric verification',
        gradient: 'from-purple-600 to-pink-600',
        glow: 'shadow-purple-500/30',
        border: 'border-purple-500/20',
        bg: 'bg-purple-500/10',
        iconColor: 'text-purple-400',
        hoverBg: 'hover:bg-purple-500/15',
        pill: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
        pillText: 'Secure',
    },
];

function formatDateTime(dateStr: string) {
    const d = new Date(dateStr);
    return {
        date: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
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

export default function ClassroomDetailPage({ params }: { params: Promise<{ sectionId: string }> }) {
    const { sectionId } = use(params);
    const router = useRouter();

    const [section, setSection] = useState<any>(null);
    const [lectures, setLectures] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [lecturesLoading, setLecturesLoading] = useState(true);

    /* Attendance modal state */
    const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
    const [attendanceInitialView, setAttendanceInitialView] = useState<AttendanceView>(null);
    const [attendanceMarked, setAttendanceMarked] = useState<boolean | null>(null);
    const [attendanceMarkedAt, setAttendanceMarkedAt] = useState<string | null>(null);
    const [selectedLectureId, setSelectedLectureId] = useState<string | null>(null);

    /* Schedule lecture modal */
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);

    /* Live clock */
    const [liveTime, setLiveTime] = useState('');
    const [liveDate, setLiveDate] = useState('');
    useEffect(() => {
        const tick = () => {
            const now = new Date();
            setLiveTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
            setLiveDate(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    const loadSection = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`/sections/${sectionId}`);
            if (res.success) setSection(res.data.section);
        } catch {
            toast.error('Failed to load classroom');
            router.push('/teacher/dashboard');
        } finally {
            setLoading(false);
        }
    }, [sectionId, router]);

    const loadLectures = useCallback(async () => {
        setLecturesLoading(true);
        try {
            const res = await fetchWithAuth(`/sections/${sectionId}/lectures`);
            if (res.success) setLectures(res.data.lectures || []);
        } catch {
            // non-critical
        } finally {
            setLecturesLoading(false);
        }
    }, [sectionId]);

    const checkAttendanceStatus = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/teacher-attendance/status');
            if (res.success) {
                setAttendanceMarked(res.data.marked);
                setAttendanceMarkedAt(res.data.record?.markedAt || null);
            }
        } catch { /* non-critical */ }
    }, []);

    useEffect(() => {
        loadSection();
        loadLectures();
        checkAttendanceStatus();
    }, [loadSection, loadLectures, checkAttendanceStatus]);

    const openAttendanceModal = (view: AttendanceView = null, lectureId: string | null = null) => {
        setAttendanceInitialView(view);
        setSelectedLectureId(lectureId);
        setIsAttendanceModalOpen(true);
    };

    const handleCancelLecture = async (lectureId: string) => {
        if (!confirm('Cancel this lecture?')) return;
        try {
            await fetchWithAuth(`/sections/${sectionId}/lectures/${lectureId}`, { method: 'DELETE' });
            toast.success('Lecture cancelled');
            loadLectures();
        } catch (e: any) {
            toast.error(e.message || 'Failed to cancel');
        }
    };

    const copyCode = () => {
        if (!section?.joinCode) return;
        navigator.clipboard.writeText(section.joinCode);
        toast.success('Join code copied!');
    };

    const getAttendanceTime = () =>
        attendanceMarkedAt
            ? new Date(attendanceMarkedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
            : '';

    if (loading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
            </DashboardLayout>
        );
    }

    const upcomingLectures = lectures.filter(l => l.status === 'SCHEDULED' || l.status === 'ONGOING');
    const pastLectures = lectures.filter(l => l.status === 'COMPLETED' || l.status === 'CANCELLED');

    return (
        <DashboardLayout>
            <div className="space-y-10">

                {/* ── Back + Header ── */}
                <div className="space-y-4">
                    <Link
                        href="/teacher/dashboard"
                        className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                    </Link>

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div>
                            <h1 className="text-4xl font-black tracking-tight text-gradient">
                                {section?.courseId?.courseName || 'Classroom'}
                            </h1>
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                                <span className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-[11px] font-bold text-primary uppercase tracking-widest">
                                    {section?.courseId?.courseCode}
                                </span>
                                <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[11px] font-bold text-white/40 uppercase tracking-widest">
                                    {section?.sectionName}
                                </span>
                                <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[11px] font-bold text-white/40 uppercase tracking-widest">
                                    {section?.semester} {section?.academicYear}
                                </span>
                            </div>
                        </div>

                        {/* Join Code + Student Count */}
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center gap-1 px-5 py-3 bg-white/5 border border-white/10 rounded-2xl">
                                <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">Students</span>
                                <span className="text-2xl font-black text-white">{section?.students?.length || 0}</span>
                            </div>
                            <div
                                onClick={copyCode}
                                className="flex flex-col items-center gap-1 px-5 py-3 bg-primary/10 border border-primary/20 rounded-2xl cursor-pointer hover:bg-primary/15 transition-all group"
                            >
                                <span className="text-[9px] font-black text-primary/60 uppercase tracking-widest">Join Code</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl font-black tracking-widest text-primary">{section?.joinCode}</span>
                                    <Copy className="w-4 h-4 text-primary/60 group-hover:text-primary transition-colors" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ════════════════════════════════════════════════════════════ */}
                {/*  TEACHER ATTENDANCE CARD — lives INSIDE this classroom only */}
                {/* ════════════════════════════════════════════════════════════ */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 280, damping: 26 }}
                    className="relative overflow-hidden rounded-[40px] border border-white/8 glass-card"
                >
                    {/* Background glow blobs */}
                    <div className="absolute top-0 left-1/4 w-80 h-32 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 right-1/4 w-64 h-24 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

                    <div className="relative p-8 md:p-10 space-y-8">

                        {/* Card Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                            <div className="flex items-center gap-4">
                                <div className="shrink-0 w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shadow-lg shadow-indigo-500/10">
                                    <ShieldCheck className="w-7 h-7 text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
                                        Teacher Attendance
                                    </h2>
                                    <p className="text-white/40 text-xs font-medium mt-0.5">
                                        Mark your attendance for this classroom session
                                    </p>
                                </div>
                            </div>

                            {/* Status badge + live time */}
                            <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                                <AnimatePresence mode="wait">
                                    {attendanceMarked === null ? (
                                        <motion.div key="loading-badge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                                            <div className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white/50 animate-spin" />
                                            <span className="text-xs text-white/30 font-medium">Checking…</span>
                                        </motion.div>
                                    ) : attendanceMarked ? (
                                        <motion.div key="marked-badge"
                                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/15 border border-emerald-500/30">
                                            <BadgeCheck className="w-4 h-4 text-emerald-400" />
                                            <span className="text-xs font-bold text-emerald-300">Present · {getAttendanceTime()}</span>
                                        </motion.div>
                                    ) : (
                                        <motion.button key="not-marked-badge"
                                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                                            onClick={() => openAttendanceModal()}
                                            className="group flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15 transition-all">
                                            <AlertCircle className="w-4 h-4 text-amber-400" />
                                            <span className="text-xs font-bold text-amber-300">Not Marked · Mark Now</span>
                                            <ChevronRight className="w-3.5 h-3.5 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                                        </motion.button>
                                    )}
                                </AnimatePresence>
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/4 border border-white/8 text-[11px] text-white/35 font-mono">
                                    <Clock className="w-3 h-3" /> {liveTime}
                                </div>
                            </div>
                        </div>

                        {/* Date strip */}
                        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/3 border border-white/6 w-fit">
                            <CalendarDays className="w-4 h-4 text-white/30" />
                            <span className="text-xs text-white/40 font-medium">{liveDate}</span>
                        </div>

                        {/* Action Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {ATTENDANCE_ACTIONS.map((action, i) => {
                                const Icon = action.icon;
                                return (
                                    <motion.button
                                        key={action.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.15 + i * 0.08, type: 'spring', stiffness: 260, damping: 24 }}
                                        whileHover={{ scale: 1.03, y: -3 }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={() => openAttendanceModal(action.id)}
                                        className={`group relative flex flex-col items-start gap-5 p-6 rounded-[28px] border ${action.border} ${action.bg} ${action.hoverBg} hover:border-white/20 transition-all duration-300 shadow-lg ${action.glow} hover:shadow-xl text-left overflow-hidden`}
                                    >
                                        <div className={`absolute inset-0 bg-gradient-to-br ${action.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300 rounded-[28px]`} />
                                        <div className="relative flex items-start justify-between w-full">
                                            <div className={`w-14 h-14 rounded-2xl ${action.bg} border ${action.border} flex items-center justify-center shadow-md`}>
                                                <Icon className={`w-7 h-7 ${action.iconColor}`} />
                                            </div>
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${action.pill}`}>
                                                {action.pillText}
                                            </span>
                                        </div>
                                        <div className="relative space-y-1">
                                            <p className={`text-base font-black ${action.iconColor}`}>{action.label}</p>
                                            <p className="text-xs text-white/40 leading-relaxed">{action.subtitle}</p>
                                        </div>
                                        <div className={`relative flex items-center gap-1.5 text-xs font-bold ${action.iconColor} group-hover:gap-2.5 transition-all`}>
                                            <Zap className="w-3.5 h-3.5" />
                                            <span>Get Started</span>
                                            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                                        </div>
                                    </motion.button>
                                );
                            })}
                        </div>

                        {/* Not-marked reminder */}
                        {attendanceMarked === false && (
                            <motion.div
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center justify-between p-4 rounded-2xl bg-amber-500/8 border border-amber-500/20"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-amber-500/15">
                                        <Scan className="w-4 h-4 text-amber-400" />
                                    </div>
                                    <p className="text-sm font-bold text-amber-300">Your attendance is not marked yet</p>
                                </div>
                                <button
                                    onClick={() => openAttendanceModal('scan_face')}
                                    className="text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
                                >
                                    Scan Now →
                                </button>
                            </motion.div>
                        )}
                    </div>
                </motion.div>

                {/* ════════════════════════════════════════════════════════════ */}
                {/*  LECTURE SCHEDULE                                           */}
                {/* ════════════════════════════════════════════════════════════ */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <h3 className="text-2xl font-black tracking-tight">Lecture Schedule</h3>
                            <span className="px-3 py-1 bg-white/5 rounded-full border border-white/5 text-[10px] font-bold text-white/40">
                                {upcomingLectures.length} upcoming
                            </span>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setIsScheduleModalOpen(true)}
                            className="flex items-center gap-2 bg-primary hover:bg-primary-glow text-white px-6 py-3 rounded-[20px] transition-all shadow-lg shadow-primary/20 text-xs font-bold uppercase tracking-widest"
                        >
                            <Plus className="w-4 h-4" />
                            Schedule Lecture
                        </motion.button>
                    </div>

                    {lecturesLoading ? (
                        <div className="space-y-3">
                            {[1, 2].map(i => (
                                <div key={i} className="h-24 bg-white/5 animate-pulse rounded-[24px]" />
                            ))}
                        </div>
                    ) : upcomingLectures.length > 0 ? (
                        <div className="space-y-3">
                            {upcomingLectures.map((lecture, i) => {
                                const start = formatDateTime(lecture.scheduledStart);
                                const end = formatDateTime(lecture.scheduledEnd);
                                return (
                                    <motion.div
                                        key={lecture._id}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.06 }}
                                        className="glass-card p-5 rounded-[24px] border-white/5 flex items-center justify-between gap-4 hover:border-primary/15 transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                                <BookOpen className="w-5 h-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-black text-sm">{lecture.topic}</p>
                                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                                    <span className="flex items-center gap-1 text-[11px] text-white/40">
                                                        <Calendar className="w-3 h-3" /> {start.date}
                                                    </span>
                                                    <span className="flex items-center gap-1 text-[11px] text-white/40">
                                                        <Clock className="w-3 h-3" /> {start.time} – {end.time}
                                                    </span>
                                                    {lecture.roomNumber && (
                                                        <span className="text-[11px] text-white/30">📍 {lecture.roomNumber}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${getStatusColor(lecture.status)}`}>
                                                {lecture.status}
                                            </span>
                                            {(lecture.status === 'ONGOING' || lecture.status === 'SCHEDULED') && (
                                                <button
                                                    onClick={() => openAttendanceModal('scan_face', lecture._id)}
                                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all text-xs font-bold text-emerald-400"
                                                >
                                                    <Scan className="w-3.5 h-3.5" />
                                                    Mark
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleCancelLecture(lecture._id)}
                                                className="p-2 rounded-xl bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 hover:border-red-500/30 transition-all"
                                            >
                                                <Trash2 className="w-4 h-4 text-red-400/60 hover:text-red-400 transition-colors" />
                                            </button>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="glass-card p-12 rounded-[35px] text-center border-2 border-dashed border-white/5 space-y-5">
                            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                                <Calendar className="w-8 h-8 text-primary/40" />
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-lg font-bold">No lectures scheduled</h4>
                                <p className="text-sm text-white/30 max-w-xs mx-auto">
                                    Schedule a lecture so students can see it on their dashboard.
                                </p>
                            </div>
                            <button
                                onClick={() => setIsScheduleModalOpen(true)}
                                className="btn-primary"
                            >
                                Schedule First Lecture
                            </button>
                        </div>
                    )}

                    {/* Past Lectures (collapsible) */}
                    {pastLectures.length > 0 && (
                        <div className="space-y-3 pt-4">
                            <h4 className="text-sm font-bold text-white/30 uppercase tracking-widest">Past Lectures</h4>
                            {pastLectures.slice(0, 5).map((lecture, i) => {
                                const start = formatDateTime(lecture.scheduledStart);
                                return (
                                    <div
                                        key={lecture._id}
                                        className="glass-card p-4 rounded-[20px] border-white/3 flex items-center justify-between gap-4 opacity-50"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                                                <BookOpen className="w-4 h-4 text-white/30" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-white/60">{lecture.topic}</p>
                                                <p className="text-[11px] text-white/30">{start.date}</p>
                                            </div>
                                        </div>
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${getStatusColor(lecture.status)}`}>
                                            {lecture.status}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Students Section ── */}
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <h3 className="text-2xl font-black tracking-tight">Enrolled Students</h3>
                        <span className="px-3 py-1 bg-white/5 rounded-full border border-white/5 text-[10px] font-bold text-white/40">
                            {section?.students?.length || 0}
                        </span>
                    </div>
                    {section?.students?.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {section.students.map((student: any, i: number) => (
                                <motion.div
                                    key={student._id}
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.04 }}
                                    className="glass-card p-4 rounded-[20px] border-white/5 flex items-center gap-4"
                                >
                                    <div className="w-10 h-10 rounded-full bg-primary/20 border border-primary/20 flex items-center justify-center text-sm font-black text-primary shrink-0">
                                        {student.fullName?.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold truncate">{student.fullName}</p>
                                        <p className="text-[11px] text-white/40 truncate">{student.prn || student.email}</p>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    ) : (
                        <div className="glass-card p-10 rounded-[35px] text-center border-2 border-dashed border-white/5">
                            <Users className="w-10 h-10 text-white/10 mx-auto mb-3" />
                            <p className="text-white/30 text-sm">No students enrolled yet. Share the join code above.</p>
                        </div>
                    )}
                </div>

            </div>

            {/* Modals */}
            <TeacherAttendanceModal
                isOpen={isAttendanceModalOpen}
                onClose={() => {
                    setIsAttendanceModalOpen(false);
                    setAttendanceInitialView(null);
                    setSelectedLectureId(null);
                }}
                onSuccess={() => {
                    setAttendanceMarked(true);
                    setAttendanceMarkedAt(new Date().toISOString());
                }}
                initialView={attendanceInitialView}
                lectureId={selectedLectureId}
            />

            <ScheduleLectureModal
                isOpen={isScheduleModalOpen}
                onClose={() => setIsScheduleModalOpen(false)}
                sectionId={sectionId}
                onSuccess={loadLectures}
            />
        </DashboardLayout>
    );
}
