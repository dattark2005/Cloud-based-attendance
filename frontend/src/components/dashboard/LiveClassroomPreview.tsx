'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    const [camError, setCamError] = useState<string | null>(null);
    const cameraActiveTimer = useRef<NodeJS.Timeout | null>(null);

    // Camera / canvas refs
    const videoRef   = useRef<HTMLVideoElement>(null);
    const canvasRef  = useRef<HTMLCanvasElement>(null);
    const wsRef      = useRef<WebSocket | null>(null);
    const snapRef    = useRef<HTMLCanvasElement | null>(null); // offscreen snap canvas
    const sendingRef = useRef(false);
    const prevNamesRef   = useRef<Set<string>>(new Set());
    // Tracks per-name leave timers — LEAVE is only logged after 60s of absence
    const leaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Activity Logs
    const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

    const addActivityLog = useCallback((message: string, type: 'ENTER' | 'LEAVE') => {
        const id = Math.random().toString(36).substring(7);
        setActivityLogs(prev => [{ id, message, type, timestamp: new Date() }, ...prev].slice(0, 50));
    }, []);

    // ── Start webcam via getUserMedia ──
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
                audio: false,
            });
            const video = videoRef.current;
            if (video) {
                video.srcObject = stream;
                await video.play();
                setCameraActive(true);
                setCamError(null);
            }
            snapRef.current = document.createElement('canvas');
        } catch {
            setCamError('Camera access denied — please allow camera permission and refresh.');
        }
    }, []);

    // Fixed resolution Python always receives — coords are always in this space
    const SNAP_W = 640;
    const SNAP_H = 360;

    // ── Draw boxes returned by Python onto the canvas overlay ──
    const drawBoxes = useCallback((boxes: { x: number; y: number; w: number; h: number; name: string; conf: number }[]) => {
        const canvas = canvasRef.current;
        const video  = videoRef.current;
        if (!canvas || !video) return;

        // Fit canvas to displayed video element
        const rect = video.getBoundingClientRect();
        if (rect.width === 0) return;
        canvas.width  = rect.width;
        canvas.height = rect.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Python coords are in SNAP_W x SNAP_H space — scale to canvas
        const scaleX = canvas.width  / SNAP_W;
        const scaleY = canvas.height / SNAP_H;

        boxes.forEach(b => {
            const isKnown = !!b.name && b.name !== 'Detecting...';

            // Scale from snapshot space to canvas space
            const bx = b.x * scaleX;
            const by = b.y * scaleY;
            const bw = b.w * scaleX;
            const bh = b.h * scaleY;

            // Webcam display is mirrored — flip X so box follows the visual face
            const rx = canvas.width - bx - bw;

            ctx.strokeStyle = isKnown ? '#22d3ee' : '#f97316';
            ctx.lineWidth   = 2;
            ctx.strokeRect(rx, by, bw, bh);

            const label = isKnown ? `${b.name}  ${Math.round(b.conf * 100)}%` : 'Detecting...';
            ctx.font = 'bold 13px Inter, sans-serif';
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = isKnown ? 'rgba(34,211,238,0.9)' : 'rgba(249,115,22,0.85)';
            ctx.fillRect(rx, by - 22, tw + 10, 22);
            ctx.fillStyle = '#000';
            ctx.fillText(label, rx + 5, by - 5);
        });
    }, []);

    // ── WebSocket: send snapshot → Python face recognition → draw boxes ──
    useEffect(() => {
        let ws: WebSocket;
        let interval: ReturnType<typeof setInterval>;

        const capture = () => {
            const video = videoRef.current;
            const snap  = snapRef.current;
            if (!video || !snap || video.readyState < 4 || video.paused || sendingRef.current) return;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            // Always send at fixed 640x360 — Python coords will always be in this space
            const nW = video.videoWidth  || 1280;
            const nH = video.videoHeight || 720;

            // object-cover crop from native frame into 640x360
            const scale = Math.max(SNAP_W / nW, SNAP_H / nH);
            const srcW  = SNAP_W / scale;
            const srcH  = SNAP_H / scale;
            const srcX  = (nW - srcW) / 2;
            const srcY  = (nH - srcH) / 2;

            snap.width  = SNAP_W;
            snap.height = SNAP_H;
            const ctx = snap.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, SNAP_W, SNAP_H);

            sendingRef.current = true;
            snap.toBlob(blob => {
                if (blob && ws.readyState === WebSocket.OPEN) ws.send(blob);
                sendingRef.current = false;
            }, 'image/jpeg', 0.8);
        };

        const connect = () => {
            ws = new WebSocket('ws://localhost:5000');
            wsRef.current = ws;

            ws.onopen  = () => { interval = setInterval(capture, 120); };

            ws.onmessage = (evt) => {
                try {
                    const data  = JSON.parse(evt.data);
                    const boxes = (data.boxes || []) as { x: number; y: number; w: number; h: number; name: string; conf: number }[];
                    drawBoxes(boxes);

                    // Activity log: ENTER immediately, LEAVE only after 1 min of continuous absence
                    const currentNames = new Set<string>(
                        boxes.filter(b => b.name && b.name !== 'Detecting...').map(b => b.name)
                    );

                    // Person disappeared — start 60s timer before logging LEAVE
                    prevNamesRef.current.forEach(name => {
                        if (!currentNames.has(name) && !leaveTimersRef.current.has(name)) {
                            const t = setTimeout(() => {
                                leaveTimersRef.current.delete(name);
                                addActivityLog(`${name} left camera view`, 'LEAVE');
                            }, 60_000);
                            leaveTimersRef.current.set(name, t);
                        }
                    });

                    // Person reappeared — cancel pending leave timer + log ENTER
                    currentNames.forEach(name => {
                        if (leaveTimersRef.current.has(name)) {
                            clearTimeout(leaveTimersRef.current.get(name));
                            leaveTimersRef.current.delete(name);
                        }
                        if (!prevNamesRef.current.has(name)) {
                            addActivityLog(`${name} entered camera view`, 'ENTER');
                        }
                    });

                    prevNamesRef.current = currentNames;
                } catch {}
            };

            ws.onclose = () => { clearInterval(interval); setTimeout(connect, 3000); };
        };

        connect();
        return () => {
            clearInterval(interval);
            ws?.close();
            // Clear all pending leave timers on unmount
            leaveTimersRef.current.forEach(t => clearTimeout(t));
            leaveTimersRef.current.clear();
        };
    }, [drawBoxes, addActivityLog]);

    const loadPresenceData = async () => {
        if (!lectureId) return;
        try {
            setLoading(true);
            const res = await fetchWithAuth(`/door/presence/${lectureId}`);
            if (res.success) {
                setPresenceData(res.data.students || []);
                setPresenceStats(res.data.stats || null);
            }

            // Also load historical activity logs
            const resLogs = await fetchWithAuth(`/door/lecture/${lectureId}`);
            if (resLogs.success && resLogs.data?.students) {
                const allEvents: ActivityLog[] = [];
                resLogs.data.students.forEach((s: any) => {
                    let currentStatus: string | null = null;
                    s.events.forEach((ev: any) => {
                        const ts = new Date(ev.timestamp);
                        if ((ev.type === 'SEEN' || ev.type === 'ENTRY') && currentStatus !== 'SEEN') {
                            currentStatus = 'SEEN';
                            allEvents.push({ id: Math.random().toString(36).substring(7), message: `🟢 ${s.student.fullName} entered`, type: 'ENTER', timestamp: ts });
                        } else if ((ev.type === 'ABSENT' || ev.type === 'EXIT') && currentStatus === 'SEEN') {
                            currentStatus = 'ABSENT';
                            allEvents.push({ id: Math.random().toString(36).substring(7), message: `🔴 ${s.student.fullName} left (absent)`, type: 'LEAVE', timestamp: ts });
                        }
                    });
                });

                // Sort descending by timestamp, take top 50
                allEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
                setActivityLogs(allEvents.slice(0, 50));
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
            // Use loose comparison — lectureId may be ObjectId on server vs string from prop
            const payloadLid = payload.lectureId?.toString?.() ?? payload.lectureId;
            const ownLid = lectureId?.toString?.() ?? lectureId;
            if (payloadLid && ownLid && payloadLid !== ownLid) return;

            setCameraActive(true);
            if (cameraActiveTimer.current) clearTimeout(cameraActiveTimer.current);
            cameraActiveTimer.current = setTimeout(() => setCameraActive(false), 30000);

            setPresenceData(prev => {
                const existing = prev.find(s => s.student._id.toString() === payload.studentId.toString());
                const prevStatus = existing?.currentStatus ?? null;

                // Log activity: ENTER on first detection or recovery from ABSENT
                // LEAVE on transition from SEEN → ABSENT
                if (payload.status === 'SEEN' && prevStatus !== 'SEEN') {
                    // First time seen OR came back after being absent
                    addActivityLog(`${payload.studentName} entered the classroom`, 'ENTER');
                } else if (payload.status === 'ABSENT' && prevStatus === 'SEEN') {
                    addActivityLog(`${payload.studentName} left (absent)`, 'LEAVE');
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

                const newList = existing
                    ? prev.map(s => s.student._id.toString() === payload.studentId.toString() ? updated : s)
                    : [...prev, updated];

                // Update stats from the live list (no extra API call needed)
                const presentCount = newList.filter(s => s.currentlyPresent).length;
                const absentCount = newList.filter(s => s.currentStatus === 'ABSENT').length;
                const unseenCount = newList.filter(s => !s.currentStatus).length;
                setPresenceStats(prev => prev
                    ? { ...prev, present: presentCount, absent: absentCount, unseen: unseenCount }
                    : { total: newList.length, present: presentCount, absent: absentCount, unseen: unseenCount }
                );

                return newList;
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

                {/* ── LIVE CAMERA FEED (getUserMedia) + Canvas Overlay ── */}
                <div className={`relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl ${loading ? 'hidden' : 'block'}`}>

                    {/* Native camera video — raw feed, no mirror */}
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                        onLoadedMetadata={() => { setCameraActive(true); }}
                    />

                    {/* Canvas overlay — NOT CSS-mirrored; X-flip applied in drawBoxes() */}
                    <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full pointer-events-none"
                    />

                    {/* Start Camera button (first load) */}
                    {!cameraActive && !camError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10">
                            <button
                                onClick={startCamera}
                                className="px-6 py-3 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-black font-black text-sm transition-all shadow-[0_0_20px_rgba(34,211,238,0.4)] hover:scale-105"
                            >
                                🎥 Start Camera
                            </button>
                            <p className="text-white/40 text-xs mt-3">Camera runs locally in browser — no video sent to server</p>
                        </div>
                    )}

                    {camError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10">
                            <WifiOff className="w-8 h-8 text-red-400 mb-3" />
                            <p className="text-white/80 font-bold text-sm">{camError}</p>
                        </div>
                    )}

                    {cameraActive && (
                        <div className="absolute top-3 right-3 px-2 py-0.5 rounded text-[10px] font-bold bg-black/60 text-white/80 border border-cyan-500/30 backdrop-blur-sm shadow-md flex items-center gap-1.5 z-20">
                            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            LIVE · Direct Camera
                        </div>
                    )}
                </div>

                <div className={`space-y-4 ${loading ? 'hidden' : 'block'}`}>
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
                                    const order: Record<string, number> = { SEEN: 0, ABSENT: 2 };
                                    // Unseen (null, never detected) appears in the middle (1) instead of after ABSENT
                                    return (order[a.currentStatus ?? ''] ?? 1) - (order[b.currentStatus ?? ''] ?? 1);
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
