'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, XCircle, CheckCircle2,
    Calendar, BadgeCheck, AlertCircle,
    ChevronRight, Users, Loader2,
    UserCheck, UserX, ShieldCheck, RefreshCw, Activity
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import DashboardLayout from '@/components/DashboardLayout';
import LiveClassroomPreview from '@/components/dashboard/LiveClassroomPreview';
import TeacherAttendanceModal from '@/components/modals/TeacherAttendanceModal';
import { fetchWithAuth } from '@/lib/api';

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

    // Manual edit
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
    }, [lectureId]);

    useEffect(() => {
        loadLectureData();
        checkTeacherAttendance();
        // The LiveClassroomPreview component handles its own real-time presence/video updates via socket
    }, [loadLectureData, checkTeacherAttendance]);

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
    const isActive = lecture?.status === 'ONGOING';
    const isScheduled = lecture?.status === 'SCHEDULED';
    const isPast = lecture?.status === 'COMPLETED';
    const canTakePhoto = isActive || isScheduled;

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
                                <Calendar className="w-7 h-7 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight">
                                    {start ? start.date : 'Lecture'}
                                </h1>
                                <p className="text-white/40 text-sm mt-1">
                                    {start?.time}{end ? ` – ${end.time}` : ''}
                                    {lecture?.roomNumber ? ` · Room ${lecture.roomNumber}` : ''}
                                </p>
                                <p className="text-white/30 text-xs mt-0.5">
                                    {section?.courseId?.courseName} · {section?.sectionName}
                                </p>
                            </div>
                        </div>
                        <span className={`text-[11px] font-black uppercase tracking-widest px-4 py-2 rounded-full border self-start ${getStatusColor(lecture?.status)}`}>
                            {lecture?.status}
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-4 pt-2">
                        {lecture?.roomNumber && (
                            <div className="flex items-center gap-2 text-sm text-white/40">
                                <span>📍</span>
                                <span>Room {lecture.roomNumber}</span>
                            </div>
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

                {/* ── Teacher's Own Attendance (only for active/scheduled, NOT past lectures) ── */}
                {!isPast && (
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
                )}

                {/* ── Classroom Live Preview (only for active/scheduled) ── */}
                {canTakePhoto && lecture && (
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                    >
                        <LiveClassroomPreview activeSession={lecture} />
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
                        <div className="flex items-center gap-2">
                            {isPast && (
                                <span className="text-[10px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full uppercase tracking-widest">
                                    ✏️ Past Lecture — Edit Manually
                                </span>
                            )}
                            <button
                                onClick={loadLectureData}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/60 hover:text-white transition-all"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> Refresh
                            </button>
                        </div>
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
                                            const pct = record?.attendancePercentage || 0;
                                            const mins = record?.totalPresentMinutes || 0;
                                            const strokeColor = pct > 75 ? '#34d399' : pct > 40 ? '#fbbf24' : '#f87171';

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

                                                    <div className="flex items-center gap-4 shrink-0">
                                                        {record?.attendancePercentage !== undefined && (
                                                            <div className="flex items-center gap-2 mr-2">
                                                                <div className="text-right">
                                                                    <p className="text-[10px] uppercase font-black tracking-widest text-white/40">Present Time</p>
                                                                    <p className="text-xs font-bold font-mono text-emerald-300">{mins}m ({pct}%)</p>
                                                                </div>
                                                                <div className="w-8 h-8 relative flex items-center justify-center">
                                                                    <svg className="w-full h-full -rotate-90">
                                                                        <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                                                                        <circle cx="16" cy="16" r="14" fill="none" stroke={strokeColor} strokeWidth="3"
                                                                            strokeDasharray={`${pct * 0.88} 100`} />
                                                                    </svg>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full uppercase tracking-widest shrink-0">
                                                            Present
                                                        </span>
                                                        <button
                                                            onClick={() => updateAttendance(student._id, 'ABSENT')}
                                                            disabled={updatingId === student._id}
                                                            className="p-2 rounded-xl bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 hover:border-red-500/30 transition-all disabled:opacity-40 shrink-0"
                                                            title="Mark Absent"
                                                        >
                                                            {updatingId === student._id
                                                                ? <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin" />
                                                                : <XCircle className="w-3.5 h-3.5 text-red-400/60 hover:text-red-400 transition-colors" />
                                                            }
                                                        </button>
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
                                        {absentStudents.map((student: any, i: number) => {
                                            const record = attendanceRecords.find(r => r.studentId === student._id);
                                            const pct = record?.attendancePercentage || 0;
                                            const mins = record?.totalPresentMinutes || 0;

                                            return (
                                                <motion.div
                                                    key={student._id}
                                                    initial={{ opacity: 0, x: -12 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: i * 0.04 }}
                                                    className="glass-card p-4 rounded-[20px] border-red-500/5 flex items-center justify-between gap-4 transition-all"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm font-black text-white/40 shrink-0">
                                                            {student.fullName?.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-bold truncate">{student.fullName}</p>
                                                            <p className="text-[11px] text-white/30 truncate">{student.prn || student.email}</p>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-4 shrink-0">
                                                        {record?.attendancePercentage !== undefined && (
                                                            <div className="flex items-center gap-2 mr-2">
                                                                <div className="text-right">
                                                                    <p className="text-[10px] uppercase font-black tracking-widest text-white/40">Present Time</p>
                                                                    <p className="text-xs font-bold font-mono text-white/60">{mins}m ({pct}%)</p>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <span className="text-[10px] font-black text-red-400/70 bg-red-500/5 border border-red-500/15 px-3 py-1.5 rounded-full uppercase tracking-widest">
                                                            Absent
                                                        </span>
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
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
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
