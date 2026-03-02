'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, CheckCircle2, XCircle, Clock, Users, TrendingUp, LogIn, LogOut, Timer, ChevronDown } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { socketService } from '@/lib/socket';

interface Lecture {
    _id: string;
    topic?: string;
    scheduledStart?: string;
    isActive?: boolean;
}

interface AttendanceRecord {
    lectureId?: { _id: string };
    status: 'PRESENT' | 'ABSENT';
    markedAt: string;
}

export default function StudentClassroomPage() {
    const { sectionId } = useParams<{ sectionId: string }>();
    const router = useRouter();
    const [section, setSection] = useState<any>(null);
    const [lectures, setLectures] = useState<Lecture[]>([]);
    const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceRecord>>({});
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ present: 0, total: 0 });
    // Door timeline: lectureId → { events, totalMinutes }
    const [doorLogMap, setDoorLogMap] = useState<Record<string, { events: { type: string; timestamp: string }[]; totalMinutes: number }>>({});
    const [expandedLectures, setExpandedLectures] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        try {
            const [sectionsRes, historyRes, lecturesRes] = await Promise.all([
                fetchWithAuth('/sections/student'),
                fetchWithAuth('/attendance/history'),
                fetchWithAuth(`/sections/${sectionId}/lectures`),
            ]);

            const sec = (sectionsRes.data?.sections || []).find((s: any) => s._id === sectionId);
            setSection(sec || null);

            const lecs: Lecture[] = lecturesRes.data?.lectures || [];
            setLectures(lecs);

            const records: AttendanceRecord[] = (historyRes.data?.records || []).filter(
                (r: any) => {
                    const sec = r.lectureId?.sectionId;
                    if (!sec) return false;
                    return (sec._id || sec) === sectionId || sec._id?.toString() === sectionId;
                }
            );
            const map: Record<string, AttendanceRecord> = {};
            records.forEach(r => {
                if (r.lectureId?._id) map[r.lectureId._id] = r;
            });
            setAttendanceMap(map);
            const present = records.filter(r => r.status === 'PRESENT').length;
            setStats({ present, total: lecs.length });
        } catch {
            toast.error('Failed to load classroom');
        } finally {
            setLoading(false);
        }
    }, [sectionId]);

    const loadDoorLogs = useCallback(async (lectureIds: string[]) => {
        // Fetch own door log for each lecture (parallel, non-blocking)
        const results = await Promise.allSettled(
            lectureIds.map(lid => fetchWithAuth(`/door/my/${lid}`).then(r => ({ lid, data: r.data })))
        );
        const map: Record<string, { events: { type: string; timestamp: string }[]; totalMinutes: number }> = {};
        for (const r of results) {
            if (r.status === 'fulfilled') {
                map[r.value.lid] = r.value.data || { events: [], totalMinutes: 0 };
            }
        }
        setDoorLogMap(map);
    }, []);

    useEffect(() => {
        load().then(() => {
            // After load, fetch door logs for all lectures
            setLectures(prev => { loadDoorLogs(prev.map(l => l._id)); return prev; });
        });

        // Real-time: join section socket room and refresh when teacher updates attendance
        const socket = socketService.connect();
        socket.emit('join_section', sectionId);

        const handleUpdate = () => { load(); };
        socket.on('attendance:updated', handleUpdate);
        socket.on('session:started', handleUpdate);
        socket.on('session:ended', handleUpdate);

        // Real-time door events for this student
        const handleDoorEvent = (payload: any) => {
            setDoorLogMap(prev => {
                const lid = payload.lectureId?.toString();
                if (!lid) return prev;
                const existing = prev[lid] || { events: [], totalMinutes: 0 };
                return { ...prev, [lid]: { ...existing, events: [...existing.events, { type: payload.type, timestamp: payload.timestamp }] } };
            });
        };
        socket.on('door:event', handleDoorEvent);

        return () => {
            socket.off('attendance:updated', handleUpdate);
            socket.off('session:started', handleUpdate);
            socket.off('session:ended', handleUpdate);
            socket.off('door:event', handleDoorEvent);
        };
    }, [load, sectionId]);

    const rate = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

    return (
        <DashboardLayout>
            <div className="max-w-3xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.back()}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 transition-all"
                    >
                        <ArrowLeft className="w-5 h-5 text-white/60" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">
                            {loading ? '—' : section?.courseId?.courseName || 'Classroom'}
                        </h1>
                        <p className="text-white/40 text-sm">
                            {section?.courseId?.courseCode} · {section?.teacherId?.fullName}
                        </p>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                    {[
                        { label: 'Attendance Rate', value: `${rate}%`, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
                        { label: 'Present', value: stats.present, icon: CheckCircle2, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
                        { label: 'Total Lectures', value: stats.total, icon: BookOpen, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
                    ].map((s, i) => {
                        const Icon = s.icon;
                        return (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.07 }}
                                className={`glass-card p-5 rounded-[22px] border ${s.border} flex flex-col items-center text-center gap-2`}
                            >
                                <div className={`w-9 h-9 ${s.bg} rounded-xl flex items-center justify-center`}>
                                    <Icon className={`w-4.5 h-4.5 ${s.color}`} />
                                </div>
                                <p className="text-xl font-black">{loading ? '—' : s.value}</p>
                                <p className="text-[10px] text-white/35 font-bold uppercase tracking-widest leading-tight">{s.label}</p>
                            </motion.div>
                        );
                    })}
                </div>

                {/* Attendance Rate Bar */}
                {!loading && stats.total > 0 && (
                    <div className="glass-card p-5 rounded-[22px] border border-white/8 space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-white/60">Overall Attendance</span>
                            <span className={`text-sm font-black ${rate >= 75 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>{rate}%</span>
                        </div>
                        <div className="h-2 bg-white/8 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${rate}%` }}
                                transition={{ duration: 0.8, ease: 'easeOut' }}
                                className={`h-full rounded-full ${rate >= 75 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            />
                        </div>
                        {rate < 75 && (
                            <p className="text-[11px] text-amber-400/70">⚠️ Attendance below 75% threshold</p>
                        )}
                    </div>
                )}

                {/* Lecture List */}
                <div className="space-y-3">
                    <h2 className="text-lg font-black tracking-tight">Lecture History</h2>

                    {loading ? (
                        [1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-white/5 animate-pulse rounded-2xl" />)
                    ) : lectures.length === 0 ? (
                        <div className="glass-card p-12 rounded-[28px] text-center border-dashed border-2 border-white/5">
                            <BookOpen className="w-10 h-10 text-white/15 mx-auto mb-3" />
                            <p className="text-white/30 text-sm">No lectures yet for this class.</p>
                        </div>
                    ) : (
                        lectures.map((lec, i) => {
                            const record = attendanceMap[lec._id];
                            const isPresent = record?.status === 'PRESENT';
                            const isAbsent = record?.status === 'ABSENT';
                            const doorData = doorLogMap[lec._id];
                            const hasDoorEvents = doorData && doorData.events.length > 0;
                            const isExpanded = expandedLectures.has(lec._id);
                            const toggleExpand = () => setExpandedLectures(prev => {
                                const next = new Set(prev);
                                isExpanded ? next.delete(lec._id) : next.add(lec._id);
                                return next;
                            });

                            return (
                                <motion.div
                                    key={lec._id}
                                    initial={{ opacity: 0, x: -6 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.04 }}
                                    className="rounded-2xl border border-white/6 overflow-hidden"
                                >
                                    {/* Main row */}
                                    <button
                                        onClick={hasDoorEvents ? toggleExpand : undefined}
                                        className={`w-full flex items-center justify-between p-4 bg-white/4 text-left gap-3 ${hasDoorEvents ? 'hover:bg-white/6 cursor-pointer' : 'cursor-default'} transition-all`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isPresent ? 'bg-emerald-500/15' : isAbsent ? 'bg-rose-500/10' : 'bg-white/5'}`}>
                                                {isPresent ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                                    : isAbsent ? <XCircle className="w-4 h-4 text-rose-400" />
                                                        : <Clock className="w-4 h-4 text-white/20" />}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold truncate">
                                                    {lec.scheduledStart
                                                        ? new Date(lec.scheduledStart).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                                                        : `Lecture ${i + 1}`}
                                                </p>
                                                {lec.scheduledStart && (
                                                    <p className="text-[11px] text-white/35 mt-0.5">
                                                        {new Date(lec.scheduledStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                        {(lec as any).roomNumber ? ` · Room ${(lec as any).roomNumber}` : ''}
                                                        {doorData?.totalMinutes ? ` · ${doorData.totalMinutes}m in class` : ''}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={`text-[10px] font-black px-3 py-1 rounded-full border ${isPresent ? 'border-emerald-500/25 text-emerald-400 bg-emerald-500/8' : isAbsent ? 'border-rose-500/20 text-rose-400 bg-rose-500/5' : 'border-white/8 text-white/25 bg-white/3'}`}>
                                                {isPresent ? 'PRESENT' : isAbsent ? 'ABSENT' : 'PENDING'}
                                            </span>
                                            {hasDoorEvents && (
                                                <ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                            )}
                                        </div>
                                    </button>

                                    {/* Door timeline (expandable) */}
                                    <AnimatePresence>
                                        {isExpanded && hasDoorEvents && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="px-4 pb-3 bg-white/2 border-t border-white/4"
                                            >
                                                <p className="text-[10px] font-black text-white/25 uppercase tracking-widest pt-3 mb-2 flex items-center gap-1.5">
                                                    <Timer className="w-3 h-3" /> Your Entry / Exit Log
                                                </p>
                                                <div className="space-y-1.5">
                                                    {doorData.events.map((ev, j) => (
                                                        <div key={j} className={`flex items-center gap-3 text-[12px] py-1.5 px-3 rounded-xl ${ev.type === 'ENTRY' ? 'bg-emerald-500/8 border border-emerald-500/10' : 'bg-red-500/5 border border-red-500/8'}`}>
                                                            {ev.type === 'ENTRY'
                                                                ? <LogIn className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                                                : <LogOut className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                                            }
                                                            <span className={`font-bold ${ev.type === 'ENTRY' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {ev.type === 'ENTRY' ? 'Entered' : 'Left'}
                                                            </span>
                                                            <span className="text-white/40 ml-auto text-[11px]">
                                                                {new Date(ev.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                                {doorData.totalMinutes > 0 && (
                                                    <p className="text-[11px] text-violet-400 font-black mt-3 flex items-center gap-1.5">
                                                        <Timer className="w-3 h-3" /> Total: {doorData.totalMinutes} minutes in class
                                                    </p>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })
                    )}
                </div>

            </div>
        </DashboardLayout>
    );
}
