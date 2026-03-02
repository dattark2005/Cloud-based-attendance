'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Users, Copy, Calendar, Clock, Plus, Trash2,
    BookOpen, CheckCircle2, ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import DashboardLayout from '@/components/DashboardLayout';
import { fetchWithAuth } from '@/lib/api';
import ScheduleLectureModal from '@/components/modals/ScheduleLectureModal';
import { socketService } from '@/lib/socket';

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
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);

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

    useEffect(() => {
        loadSection();
        loadLectures();

        // Real-time: refresh lecture list when a session starts/ends
        const socket = socketService.connect();
        socket.emit('join_section', sectionId);
        const handleSessionChange = () => loadLectures();
        socket.on('session:started', handleSessionChange);
        socket.on('session:ended', handleSessionChange);
        return () => {
            socket.off('session:started', handleSessionChange);
            socket.off('session:ended', handleSessionChange);
        };
    }, [loadSection, loadLectures, sectionId]);

    const handleCancelLecture = async (e: React.MouseEvent, lectureId: string) => {
        e.stopPropagation();
        if (!confirm('Cancel this lecture?')) return;
        try {
            await fetchWithAuth(`/sections/${sectionId}/lectures/${lectureId}`, { method: 'DELETE' });
            toast.success('Lecture cancelled');
            loadLectures();
        } catch (err: any) {
            toast.error(err.message || 'Failed to cancel');
        }
    };

    const copyCode = () => {
        if (!section?.joinCode) return;
        navigator.clipboard.writeText(section.joinCode);
        toast.success('Join code copied!');
    };

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

                {/* ════════════ LECTURE SCHEDULE ════════════ */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <h3 className="text-2xl font-black tracking-tight">Lectures</h3>
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
                                        onClick={() => router.push(`/teacher/classroom/${sectionId}/lecture/${lecture._id}`)}
                                        className="glass-card p-5 rounded-[24px] border-white/5 flex items-center justify-between gap-4 hover:border-primary/30 hover:bg-white/5 transition-all cursor-pointer group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-all">
                                                <BookOpen className="w-5 h-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-black text-sm">
                                                    {start.date}
                                                </p>
                                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                                    <span className="flex items-center gap-1 text-[11px] text-white/40">
                                                        <Clock className="w-3 h-3" /> {start.time} – {end.time}
                                                    </span>
                                                    {lecture.roomNumber && (
                                                        <span className="text-[11px] text-white/30">📍 {lecture.roomNumber}</span>
                                                    )}
                                                    {lecture.attendanceCount > 0 && (
                                                        <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                                                            <CheckCircle2 className="w-3 h-3" /> {lecture.attendanceCount} present
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${getStatusColor(lecture.status)}`}>
                                                {lecture.status}
                                            </span>
                                            <button
                                                onClick={(e) => handleCancelLecture(e, lecture._id)}
                                                className="p-2 rounded-xl bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 hover:border-red-500/30 transition-all"
                                            >
                                                <Trash2 className="w-4 h-4 text-red-400/60 hover:text-red-400 transition-colors" />
                                            </button>
                                            <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/60 transition-colors" />
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

                    {/* Past Lectures */}
                    {pastLectures.length > 0 && (
                        <div className="space-y-3 pt-4">
                            <h4 className="text-sm font-bold text-white/30 uppercase tracking-widest">Past Lectures</h4>
                            {pastLectures.slice(0, 8).map((lecture) => {
                                const start = formatDateTime(lecture.scheduledStart);
                                const end = formatDateTime(lecture.scheduledEnd);
                                return (
                                    <div
                                        key={lecture._id}
                                        onClick={() => router.push(`/teacher/classroom/${sectionId}/lecture/${lecture._id}`)}
                                        className="glass-card p-4 rounded-[20px] border-white/5 flex items-center justify-between gap-4 cursor-pointer hover:border-primary/20 hover:bg-white/4 transition-all"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                                                <BookOpen className="w-4 h-4 text-white/30" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold">{start.date}</p>
                                                <p className="text-[11px] text-white/30">{start.time} – {end.time}{lecture.roomNumber ? ` · ${lecture.roomNumber}` : ''}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${getStatusColor(lecture.status)}`}>
                                                {lecture.status}
                                            </span>
                                            {lecture.attendanceCount > 0 && (
                                                <span className="text-[11px] text-emerald-400">{lecture.attendanceCount} present</span>
                                            )}
                                        </div>
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

            <ScheduleLectureModal
                isOpen={isScheduleModalOpen}
                onClose={() => setIsScheduleModalOpen(false)}
                sectionId={sectionId}
                onSuccess={loadLectures}
            />
        </DashboardLayout>
    );
}
