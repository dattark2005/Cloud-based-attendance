'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, LogIn, LogOut, Clock, Calendar, User, Loader2, AlertCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

interface TimelineEntry {
    type: 'ENTER' | 'LEAVE';
    timestamp: string;
    durationMs: number | null;
}

interface StudentLogData {
    student: { fullName: string; prn?: string; email: string };
    lecture: { scheduledStart: string; scheduledEnd: string; roomNumber?: string; status: string };
    timeline: TimelineEntry[];
    totalMinutes: number;
    totalMs: number;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    studentId: string | null;
    studentName: string;
    lectureId: string;
}

function fmtTime(ts: string) {
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function fmtDuration(ms: number | null) {
    if (ms === null) return '—';
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
}

export default function StudentLogDrawer({ isOpen, onClose, studentId, studentName, lectureId }: Props) {
    const [data, setData] = useState<StudentLogData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !studentId) return;
        setData(null);
        setError(null);
        setLoading(true);
        fetchWithAuth(`/door/lecture/${lectureId}/student/${studentId}`)
            .then(res => {
                if (res.success) setData(res.data);
                else setError(res.message || 'Failed to load logs');
            })
            .catch(() => setError('Network error — could not load logs'))
            .finally(() => setLoading(false));
    }, [isOpen, studentId, lectureId]);

    const attendancePct = data
        ? (() => {
              const lectureMs =
                  data.lecture.scheduledEnd && data.lecture.scheduledStart
                      ? new Date(data.lecture.scheduledEnd).getTime() - new Date(data.lecture.scheduledStart).getTime()
                      : 0;
              return lectureMs > 0 ? Math.min(100, Math.round((data.totalMs / lectureMs) * 100)) : 0;
          })()
        : 0;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                        className="fixed right-0 top-0 h-full w-full max-w-md z-50 flex flex-col"
                        style={{ background: 'linear-gradient(160deg, #0d1117 0%, #0f1923 100%)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-5 border-b border-white/8">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-sm font-black text-cyan-400">
                                    {studentName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h2 className="text-base font-black text-white">{studentName}</h2>
                                    <p className="text-xs text-white/40">Attendance Timeline</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                            >
                                <X className="w-4 h-4 text-white/60" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

                            {/* Loading */}
                            {loading && (
                                <div className="flex flex-col items-center justify-center py-20 gap-3">
                                    <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                                    <p className="text-sm text-white/40">Loading activity log...</p>
                                </div>
                            )}

                            {/* Error */}
                            {error && !loading && (
                                <div className="flex flex-col items-center justify-center py-20 gap-3">
                                    <AlertCircle className="w-8 h-8 text-red-400" />
                                    <p className="text-sm text-red-400">{error}</p>
                                </div>
                            )}

                            {/* Data */}
                            {data && !loading && (
                                <>
                                    {/* Lecture info */}
                                    <div className="p-4 rounded-2xl bg-white/4 border border-white/8 flex items-center gap-3">
                                        <Calendar className="w-4 h-4 text-white/40 shrink-0" />
                                        <div>
                                            <p className="text-xs font-bold text-white/70">
                                                {new Date(data.lecture.scheduledStart).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                                            </p>
                                            <p className="text-[11px] text-white/40 mt-0.5">
                                                {fmtTime(data.lecture.scheduledStart)} – {fmtTime(data.lecture.scheduledEnd)}
                                                {data.lecture.roomNumber ? ` · Room ${data.lecture.roomNumber}` : ''}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Summary stats */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-4 rounded-2xl bg-cyan-500/8 border border-cyan-500/15 text-center">
                                            <p className="text-2xl font-black text-cyan-300">{data.totalMinutes}<span className="text-sm font-semibold text-cyan-400/60 ml-1">min</span></p>
                                            <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1 font-bold">Total Present</p>
                                        </div>
                                        <div className={`p-4 rounded-2xl border text-center ${attendancePct >= 75 ? 'bg-emerald-500/8 border-emerald-500/15' : attendancePct >= 50 ? 'bg-amber-500/8 border-amber-500/15' : 'bg-red-500/8 border-red-500/15'}`}>
                                            <p className={`text-2xl font-black ${attendancePct >= 75 ? 'text-emerald-300' : attendancePct >= 50 ? 'text-amber-300' : 'text-red-300'}`}>
                                                {attendancePct}<span className="text-sm font-semibold ml-0.5">%</span>
                                            </p>
                                            <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1 font-bold">Attendance</p>
                                        </div>
                                    </div>

                                    {/* Timeline */}
                                    <div>
                                        <h3 className="text-xs font-black text-white/50 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <Clock className="w-3.5 h-3.5" /> Entry / Exit Timeline
                                        </h3>

                                        {data.timeline.length === 0 ? (
                                            <div className="py-10 flex flex-col items-center gap-2 text-white/20">
                                                <User className="w-7 h-7" />
                                                <p className="text-sm">No detection events recorded</p>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                {/* Vertical line */}
                                                <div className="absolute left-[19px] top-0 bottom-0 w-px bg-white/8" />

                                                <div className="space-y-3">
                                                    {data.timeline.map((entry, i) => {
                                                        const isEnter = entry.type === 'ENTER';
                                                        return (
                                                            <motion.div
                                                                key={i}
                                                                initial={{ opacity: 0, x: 12 }}
                                                                animate={{ opacity: 1, x: 0 }}
                                                                transition={{ delay: i * 0.05 }}
                                                                className="flex items-start gap-4 relative"
                                                            >
                                                                {/* Dot */}
                                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 z-10 ${isEnter ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-red-500/10 border-red-500/30'}`}>
                                                                    {isEnter
                                                                        ? <LogIn className="w-4 h-4 text-emerald-400" />
                                                                        : <LogOut className="w-4 h-4 text-red-400" />}
                                                                </div>

                                                                {/* Content */}
                                                                <div className="flex-1 pb-3 min-w-0">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <p className={`text-sm font-bold ${isEnter ? 'text-emerald-300' : 'text-red-300'}`}>
                                                                            {isEnter ? 'Entered the room' : 'Left the room'}
                                                                        </p>
                                                                        <span className="text-xs font-mono text-white/50 shrink-0">
                                                                            {fmtTime(entry.timestamp)}
                                                                        </span>
                                                                    </div>
                                                                    {entry.durationMs !== null && (
                                                                        <p className="text-[11px] text-white/35 mt-0.5">
                                                                            {isEnter ? 'Stayed for' : 'Was away from'}{' '}
                                                                            <span className="font-bold text-white/50">{fmtDuration(entry.durationMs)}</span>
                                                                        </p>
                                                                    )}
                                                                    {isEnter && entry.durationMs === null && (
                                                                        <p className="text-[11px] text-emerald-400/50 mt-0.5 animate-pulse">● Still in room</p>
                                                                    )}
                                                                </div>
                                                            </motion.div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
