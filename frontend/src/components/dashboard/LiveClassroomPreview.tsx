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

    // Activity Logs
    const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);


    // Add a new activity log
    const addActivityLog = (message: string, type: 'ENTER' | 'LEAVE') => {
        const id = Math.random().toString(36).substring(7);
        // Keep the last 50 events in the history log
        setActivityLogs(prev => [{ id, message, type, timestamp: new Date() }, ...prev].slice(0, 50));
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

        socket.on('presence:update', handlePresenceUpdate);

        return () => {
            socket.off('presence:update', handlePresenceUpdate);
            if (cameraActiveTimer.current) clearTimeout(cameraActiveTimer.current);
        };
    }, [lectureId, sectionId]);


    return (
        <div className="relative glass-card p-6 rounded-[35px] border-white/5 space-y-5 overflow-hidden">
            {/* Background glow effects */}
            <div className="absolute top-[-50px] right-[-50px] w-48 h-48 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none" />
            <div className="absolute bottom-[-50px] left-[-50px] w-48 h-48 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

            {/* Activity Logs have been moved to the bottom panel */}

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
            <div className="relative z-10 space-y-4">
                {loading && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4">
                        <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
                        <p className="text-sm text-white/50 font-medium animate-pulse">Connecting to live feed...</p>
                    </div>
                )}

                {/* ── LIVE MJPEG VIDEO FEED ── */}
                <div className={`relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black/50 shadow-2xl ${(!cameraActive || loading) ? 'hidden' : 'block'}`}>
                    <img
                        src="http://localhost:5000/video_feed"
                        className="w-full h-full object-cover"
                        alt="Live Classroom Feed"
                        onLoad={() => setCameraActive(true)}
                        onError={(e) => {
                            setCameraActive(false);
                            // Auto-retry fetching the live feed every 3 seconds if Python isn't up yet
                            setTimeout(() => {
                                if (e.target) (e.target as HTMLImageElement).src = `http://localhost:5000/video_feed?t=${Date.now()}`;
                            }, 3000);
                        }}
                    />
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded text-[10px] font-bold bg-black/60 text-white/50 border border-white/10 backdrop-blur-sm shadow-md flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        LIVE
                    </div>
                </div>

                {!loading && !cameraActive && (
                    <div className="py-16 flex flex-col items-center justify-center text-center space-y-4 glass-card rounded-[24px] bg-black/20 border-dashed border-white/10">
                        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center">
                            <span className="text-2xl opacity-40">🎥</span>
                        </div>
                        <div>
                            <h3 className="text-white/60 font-bold mb-1">Camera Offline or Starting...</h3>
                            <p className="text-white/30 text-sm max-w-[280px]">
                                The high-speed MJPEG stream will appear automatically once the target connects.
                            </p>
                        </div>
                    </div>
                )}

                <div className={`space-y-4 ${(!cameraActive || loading) ? 'hidden' : 'block'}`}>
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
            </div>

            {/* ── PREMIUM STUDENT ACTIVITY LOGS ── */}
            <div className="relative z-10 glass-card rounded-[24px] bg-black/40 border border-white/10 overflow-hidden mt-6 flex flex-col h-56">
                <div className="flex items-center px-5 py-4 bg-white/5 border-b border-white/5 backdrop-blur-md">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                            <Users className="w-4 h-4 text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white tracking-wide">Student Activity Log</h3>
                            <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold mt-0.5">Real-time Presence Events</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    {activityLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-white/20 pb-4">
                            <Activity className="w-8 h-8 mb-2 opacity-20" />
                            <p className="text-sm font-medium">No student activity logged yet</p>
                            <p className="text-xs mt-1">Events will appear here when students enter or leave the camera view.</p>
                        </div>
                    ) : (
                        <div className="space-y-3 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
                            <AnimatePresence>
                                {activityLogs.map((log) => (
                                    <motion.div
                                        key={log.id}
                                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        layout
                                        className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active"
                                    >
                                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white/10 bg-black/50 backdrop-blur-sm shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 transition-colors duration-300">
                                            {log.type === 'ENTER' ? (
                                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)] animate-pulse" />
                                            ) : (
                                                <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                                            )}
                                        </div>
                                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] glass-card p-3 rounded-2xl border-white/5 shadow-sm">
                                            <div className="flex items-center justify-between">
                                                <span className={`text-sm font-bold ${log.type === 'ENTER' ? 'text-emerald-100' : 'text-red-100/80'}`}>
                                                    {log.message.replace('🟢 ', '').replace('🔴 ', '')}
                                                </span>
                                                <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest bg-black/40 px-2 py-1 rounded-md">
                                                    {log.timestamp.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                                </span>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
