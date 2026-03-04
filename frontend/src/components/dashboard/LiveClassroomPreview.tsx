'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Wifi, WifiOff, Users, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { socketService } from '@/lib/socket';

interface LiveClassroomPreviewProps {
    activeSession: any; // The lecture object
}

interface PresenceStudent {
    student: { _id: string; fullName: string; prn?: string; email?: string; faceImageUrl?: string };
    currentStatus: 'SEEN' | 'ABSENT' | null;
    lastSeen: string | null;
    lastConfidence: number;
    totalPresentMinutes: number;
    attendancePercentage: number;
    currentlyPresent: boolean;
}

interface ActivityLog {
    id: string;
    message: string;
    type: 'ENTER' | 'LEAVE';
    timestamp: Date;
}

export default function LiveClassroomPreview({ activeSession }: LiveClassroomPreviewProps) {
    const lectureId = activeSession?._id;
    const sectionId = activeSession?.sectionId?._id || activeSession?.sectionId;
    const roomNumber = activeSession?.roomNumber;

    const [presenceData, setPresenceData] = useState<PresenceStudent[]>([]);
    const [presenceStats, setPresenceStats] = useState<{ total: number; present: number; absent: number; unseen: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [cameraActive, setCameraActive] = useState(false);
    const cameraActiveTimer = useRef<NodeJS.Timeout | null>(null);
    const [liveFrame, setLiveFrame] = useState<string | null>(null);

    // Activity Logs
    const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

    // System Logs
    const [cameraLogs, setCameraLogs] = useState<{ id: string; type: 'info' | 'error'; text: string; timestamp: Date }[]>([]);

    // Add a new activity log, auto-remove after 3s
    const addActivityLog = (message: string, type: 'ENTER' | 'LEAVE') => {
        const id = Math.random().toString(36).substring(7);
        setActivityLogs(prev => [{ id, message, type, timestamp: new Date() }, ...prev].slice(0, 5)); // Keep max 5

        setTimeout(() => {
            setActivityLogs(prev => prev.filter(log => log.id !== id));
        }, 3000);
    };

    const loadPresenceData = async () => {
        if (!lectureId) return;
        try {
            setLoading(true);
            const res = await fetchWithAuth(`/door/presence/${lectureId}`);
            if (res.success) {
                setPresenceData(res.data.students || []);
                setPresenceStats(res.data.stats || null);
            }
        } catch (err) {
            console.error('Failed to load presence data', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPresenceData();

        if (!sectionId) return;

        // ── Socket Connection ──
        const socket = socketService.connect();
        socket.emit('join_section', sectionId);

        const handlePresenceUpdate = (payload: any) => {
            if (payload.lectureId?.toString() !== lectureId?.toString()) return;

            setCameraActive(true);
            if (cameraActiveTimer.current) clearTimeout(cameraActiveTimer.current);
            cameraActiveTimer.current = setTimeout(() => setCameraActive(false), 30000);

            setPresenceData(prev => {
                const existing = prev.find(s => s.student._id.toString() === payload.studentId.toString());

                // If status changed to SEEN, they entered. If status changed to ABSENT, they left.
                if (existing) {
                    if (existing.currentStatus !== 'SEEN' && payload.status === 'SEEN') {
                        addActivityLog(`🟢 ${payload.studentName} just entered`, 'ENTER');
                    } else if (existing.currentStatus !== 'ABSENT' && payload.status === 'ABSENT') {
                        addActivityLog(`🔴 ${payload.studentName} just left (absent)`, 'LEAVE');
                    }
                } else if (payload.status === 'SEEN') {
                    addActivityLog(`🟢 ${payload.studentName} just entered`, 'ENTER');
                }

                const updated: PresenceStudent = {
                    student: existing?.student || {
                        _id: payload.studentId,
                        fullName: payload.studentName,
                        prn: payload.studentPrn,
                    },
                    currentStatus: payload.status,
                    lastSeen: payload.status === 'SEEN' ? payload.timestamp : (existing?.lastSeen || null),
                    lastConfidence: payload.confidence || 0,
                    totalPresentMinutes: payload.totalPresentMinutes,
                    attendancePercentage: payload.attendancePercentage,
                    currentlyPresent: payload.status === 'SEEN',
                };

                if (existing) {
                    return prev.map(s => s.student._id.toString() === payload.studentId.toString() ? updated : s);
                }
                return [...prev, updated];
            });
        };

        const handleFrameUpdate = (base64Frame: string) => {
            setLiveFrame(base64Frame);
            setCameraActive(true);
            if (cameraActiveTimer.current) clearTimeout(cameraActiveTimer.current);
            cameraActiveTimer.current = setTimeout(() => setCameraActive(false), 5000); // 5 sec timeout for video
        };

        const handleCameraLog = (payload: { type: 'info' | 'error', text: string }) => {
            const id = Math.random().toString(36).substring(7);
            setCameraLogs(prev => [...prev, { id, type: payload.type, text: payload.text, timestamp: new Date() }].slice(-50));
        };

        socket.on('presence:update', handlePresenceUpdate);
        socket.on('camera:frame', handleFrameUpdate);
        socket.on('camera:log', handleCameraLog);

        return () => {
            socket.off('presence:update', handlePresenceUpdate);
            socket.off('camera:frame', handleFrameUpdate);
            socket.off('camera:log', handleCameraLog);
            if (cameraActiveTimer.current) clearTimeout(cameraActiveTimer.current);
        };
    }, [lectureId, sectionId]);


    return (
        <div className="relative glass-card p-6 rounded-[35px] border-white/5 space-y-5 overflow-hidden">
            {/* Background glow effects */}
            <div className="absolute top-[-50px] right-[-50px] w-48 h-48 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none" />
            <div className="absolute bottom-[-50px] left-[-50px] w-48 h-48 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

            {/* Activity Logs (Floating on top right) */}
            <div className="absolute top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
                <AnimatePresence>
                    {activityLogs.map(log => (
                        <motion.div
                            key={log.id}
                            initial={{ opacity: 0, x: 20, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9, y: -10 }}
                            className={`px-4 py-3 rounded-2xl shadow-lg border backdrop-blur-md flex items-center gap-3 ${log.type === 'ENTER'
                                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-100'
                                : 'bg-red-500/20 border-red-500/30 text-red-100'
                                }`}
                        >
                            <span className="text-sm font-bold tracking-wide">{log.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center">
                        {cameraActive ? (
                            <div className="relative flex items-center justify-center">
                                <div className="absolute w-8 h-8 bg-cyan-400/30 rounded-full animate-ping" />
                                <Activity className="w-6 h-6 text-cyan-400 relative z-10" />
                            </div>
                        ) : (
                            <WifiOff className="w-6 h-6 text-white/40" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-black tracking-tight text-white drop-shadow-sm">Live Classroom</h2>
                            {cameraActive ? (
                                <span className="px-2.5 py-1 text-[9px] font-black uppercase tracking-widest bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full animate-pulse shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                                    Live Feed Active
                                </span>
                            ) : (
                                <span className="px-2.5 py-1 text-[9px] font-black uppercase tracking-widest bg-white/10 text-white/40 border border-white/10 rounded-full">
                                    Waiting for camera
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-white/50 font-medium mt-1">
                            {activeSession?.courseId?.courseName} · Room {roomNumber || 'Unknown'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="relative z-10">
                {loading ? (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4">
                        <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
                        <p className="text-sm text-white/50 font-medium animate-pulse">Connecting to live feed...</p>
                    </div>
                ) : !cameraActive ? (
                    <div className="py-16 flex flex-col items-center justify-center text-center space-y-4 glass-card rounded-[24px] bg-black/20 border-dashed border-white/10">
                        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center">
                            <span className="text-2xl opacity-40">🎥</span>
                        </div>
                        <div>
                            <h3 className="text-white/60 font-bold mb-1">Camera Offline or Starting...</h3>
                            <p className="text-white/30 text-sm max-w-[280px]">
                                The camera stream will automatically appear here once the Python script wakes up.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* ── LIVE VIDEO FEED ── */}
                        {liveFrame && (
                            <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black/50 shadow-2xl">
                                <img
                                    src={`data:image/jpeg;base64,${liveFrame}`}
                                    className="w-full h-full object-cover"
                                    alt="Live Classroom Feed"
                                />
                                <div className="absolute top-3 right-3 px-2 py-0.5 rounded text-[10px] font-bold bg-black/60 text-white/50 border border-white/10 backdrop-blur-sm shadow-md flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                                    LIVE
                                </div>
                            </div>
                        )}

                        {/* Quick Stats */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="flex items-center gap-3 p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/10">
                                <div className="w-1.5 h-8 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                                <div>
                                    <p className="text-2xl font-black text-white">{presenceStats?.present || 0}</p>
                                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">In Room</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/5 border border-red-500/10">
                                <div className="w-1.5 h-8 bg-red-400 rounded-full" />
                                <div>
                                    <p className="text-2xl font-black text-white">{presenceStats?.absent || 0}</p>
                                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Absent</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/5">
                                <div className="w-1.5 h-8 bg-white/20 rounded-full" />
                                <div>
                                    <p className="text-2xl font-black text-white">{presenceStats?.unseen || 0}</p>
                                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Unseen</p>
                                </div>
                            </div>
                        </div>

                        {/* Mini Student Grid */}
                        <div className="p-5 rounded-[24px] bg-black/40 border border-white/5">
                            <div className="flex flex-wrap gap-2">
                                {/* Sort SEEN first */}
                                {[...presenceData]
                                    .sort((a, b) => {
                                        const order: Record<string, number> = { SEEN: 0, ABSENT: 1 };
                                        return (order[a.currentStatus ?? ''] ?? 2) - (order[b.currentStatus ?? ''] ?? 2);
                                    })
                                    .map((entry) => {
                                        const isPresent = entry.currentlyPresent;
                                        const isAbsent = entry.currentStatus === 'ABSENT';

                                        return (
                                            <div
                                                key={entry.student._id}
                                                className="relative group cursor-default"
                                            >
                                                <motion.div
                                                    initial={{ scale: 0.8, opacity: 0 }}
                                                    animate={{ scale: 1, opacity: 1 }}
                                                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black border-2 transition-all duration-300 ${isPresent
                                                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)] hover:scale-110'
                                                        : isAbsent
                                                            ? 'bg-red-500/10 border-red-500/40 text-red-500 hover:scale-110'
                                                            : 'bg-white/5 border-white/10 text-white/30 hover:bg-white/10'
                                                        }`}
                                                >
                                                    {entry.student.fullName?.charAt(0).toUpperCase()}
                                                </motion.div>

                                                {/* Tooltip */}
                                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-black/90 border border-white/10 text-xs font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                                                    {entry.student.fullName}
                                                    <div className="text-[10px] font-medium text-white/50 mt-0.5">
                                                        {isPresent ? 'In Room' : isAbsent ? 'Absent' : 'Unseen'}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ── SYSTEM LOGS TERMINAL ── */}
            <div className="relative z-10 glass-card rounded-[24px] bg-black/40 border border-white/10 overflow-hidden mt-6 flex flex-col h-48">
                <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/5">
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                        </div>
                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest ml-2">System Logs</span>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-[11px] scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent flex flex-col justify-end">
                    {cameraLogs.length === 0 ? (
                        <p className="text-white/20 empty-log">[No logs yet. Waiting for script to start...]</p>
                    ) : (
                        cameraLogs.map((log) => (
                            <div key={log.id} className="flex items-start gap-2 break-all">
                                <span className="text-white/30 shrink-0 select-none">[{log.timestamp.toLocaleTimeString('en-IN', { hour12: false })}]</span>
                                <span className={log.type === 'error' ? 'text-red-400 font-medium' : 'text-cyan-400/80'}>{log.text}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
