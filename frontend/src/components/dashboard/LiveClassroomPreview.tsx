'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, WifiOff, Users, Loader2, Camera } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { socketService } from '@/lib/socket';

interface LiveClassroomPreviewProps { activeSession: any; }
interface PresenceStudent {
    student: { _id: string; fullName: string; prn?: string; email?: string; faceImageUrl?: string };
    currentStatus: 'SEEN' | 'ABSENT' | null;
    lastSeen: string | null; lastConfidence: number;
    totalPresentMinutes: number; attendancePercentage: number; currentlyPresent: boolean;
}
interface ActivityLog { id: string; message: string; type: 'ENTER' | 'LEAVE'; timestamp: Date; }
interface FaceBox { x: number; y: number; w: number; h: number; name: string; conf: number; }

// Snapshot size sent to Python — smaller = faster encode/transfer/decode
// SFace only needs ~112px per face so 320x180 is more than enough
const SNAP_W = 320, SNAP_H = 180;

export default function LiveClassroomPreview({ activeSession }: LiveClassroomPreviewProps) {
    const lectureId  = activeSession?._id;
    const sectionId  = activeSession?.sectionId?._id || activeSession?.sectionId;
    const roomNumber = activeSession?.roomNumber;

    const [presenceData,  setPresenceData]  = useState<PresenceStudent[]>([]);
    const [presenceStats, setPresenceStats] = useState<{ total: number; present: number; absent: number; unseen: number } | null>(null);
    const [loading,       setLoading]       = useState(true);
    const [cameraActive,  setCameraActive]  = useState(false);
    const [camError,      setCamError]      = useState<string | null>(null);
    const [modelsLoaded,  setModelsLoaded]  = useState(false);
    const [activityLogs,  setActivityLogs]  = useState<ActivityLog[]>([]);

    const videoRef        = useRef<HTMLVideoElement>(null);
    const canvasRef       = useRef<HTMLCanvasElement>(null);
    const snapRef         = useRef<HTMLCanvasElement | null>(null);
    const wsRef           = useRef<WebSocket | null>(null);
    const sendingRef        = useRef(false);
    // Python boxes in SNAP coords — drawn each RAF frame scaled to display
    const pythonBoxesRef    = useRef<FaceBox[]>([]);
    // Timer ref: clears boxes only after 500ms of continuous empty responses
    const clearBoxTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Smoothed box positions — EMA interpolation so boxes glide instead of teleport
    const smoothedBoxesRef  = useRef<(FaceBox & { sx: number; sy: number; sw: number; sh: number })[]>([]);
    const prevNamesRef    = useRef<Set<string>>(new Set());
    const leaveTimersRef  = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const rafRef          = useRef<number>(0);
    const cameraTimerRef  = useRef<NodeJS.Timeout | null>(null);

    const addActivityLog = useCallback((message: string, type: 'ENTER' | 'LEAVE') => {
        setActivityLogs(prev => [{ id: Math.random().toString(36).slice(2), message, type, timestamp: new Date() }, ...prev].slice(0, 50));
    }, []);

    // face-api models pre-loaded but not used for drawing
    useEffect(() => {
        import('face-api.js').then(async faceapi => {
            await faceapi.nets.tinyFaceDetector.loadFromUri('/models').catch(() => {});
            setModelsLoaded(true);
        }).catch(() => {});
    }, []);

    // ── Start webcam ──
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false,
            });
            const video = videoRef.current;
            if (video) { video.srcObject = stream; await video.play(); setCameraActive(true); setCamError(null); }
            snapRef.current = document.createElement('canvas');
        } catch { setCamError('Camera access denied — please allow camera permission and refresh.'); }
    }, []);

    // ── Stable canvas dimensions via ResizeObserver ──
    // NEVER resize canvas inside the draw loop — it forces a full browser repaint
    // every frame which causes the video underneath to flicker.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                const { width, height } = e.contentRect;
                const w = Math.round(width);
                const h = Math.round(height);
                if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
                    canvas.width  = w;
                    canvas.height = h;
                }
            }
        });
        ro.observe(canvas);
        return () => ro.disconnect();
    }, []);

    // Draw loop — Python boxes scaled precisely to display canvas
    useEffect(() => {
        if (!cameraActive) return;
        let active = true;

        const drawLoop = () => {
            if (!active) return;
            const video  = videoRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas || video.readyState < 2) {
                rafRef.current = requestAnimationFrame(drawLoop); return;
            }

            // Canvas dimensions are set by ResizeObserver — never changed here
            const dispW = canvas.width  || 640;
            const dispH = canvas.height || 360;

            const ctx = canvas.getContext('2d');
            if (!ctx) { rafRef.current = requestAnimationFrame(drawLoop); return; }
            ctx.clearRect(0, 0, dispW, dispH);

            const targetBoxes = pythonBoxesRef.current;

            // ── Exponential smoothing: glide the displayed box toward the target ──
            // α = 0.35 means each frame moves 35% of the remaining distance.
            // At 60fps this makes boxes reach target in ~100ms — completely smooth.
            const α = 0.35;
            if (targetBoxes.length === 0) {
                if (smoothedBoxesRef.current.length === 0) {
                    rafRef.current = requestAnimationFrame(drawLoop); return;
                }
            } else {
                // When multiple faces are on screen, tighten the proximity bucket
                // so close-together faces don't get their smoothed boxes swapped
                const proximityPx = targetBoxes.length > 1 ? 40 : 80;
                const next = targetBoxes.map(t => {
                    const tcx = t.x + t.w / 2;
                    const tcy = t.y + t.h / 2;
                    // Among all smoothed entries, find the CLOSEST one within bucket
                    let bestMatch: typeof smoothedBoxesRef.current[0] | undefined;
                    let bestDist = Infinity;
                    for (const s of smoothedBoxesRef.current) {
                        const dx = Math.abs(s.sx + s.sw / 2 - tcx);
                        const dy = Math.abs(s.sy + s.sh / 2 - tcy);
                        const dist = dx + dy;
                        if (dx < proximityPx && dy < proximityPx && dist < bestDist) {
                            bestDist = dist;
                            bestMatch = s;
                        }
                    }
                    if (bestMatch) {
                        return {
                            ...t,
                            sx: bestMatch.sx + α * (t.x - bestMatch.sx),
                            sy: bestMatch.sy + α * (t.y - bestMatch.sy),
                            sw: bestMatch.sw + α * (t.w - bestMatch.sw),
                            sh: bestMatch.sh + α * (t.h - bestMatch.sh),
                        };
                    }
                    return { ...t, sx: t.x, sy: t.y, sw: t.w, sh: t.h };
                });
                smoothedBoxesRef.current = next;
            }

            const boxes = smoothedBoxesRef.current;
            if (boxes.length === 0) { rafRef.current = requestAnimationFrame(drawLoop); return; }

            const vidW = video.videoWidth  || SNAP_W;
            const vidH = video.videoHeight || SNAP_H;

            // object-cover: fill display, preserve video aspect ratio
            const coverScale = Math.max(dispW / vidW, dispH / vidH);
            const rendW = vidW * coverScale;
            const rendH = vidH * coverScale;
            const offX  = (rendW - dispW) / 2;
            const offY  = (rendH - dispH) / 2;

            // snapshot was full-frame scaled to SNAP_W x SNAP_H
            const snapScaleX = vidW / SNAP_W;
            const snapScaleY = vidH / SNAP_H;

            boxes.forEach(b => {
                // SNAP coords -> video coords (use smoothed sx/sy/sw/sh)
                const vx = b.sx * snapScaleX;
                const vy = b.sy * snapScaleY;
                const vw = b.sw * snapScaleX;
                const vh = b.sh * snapScaleY;

                // video coords -> display coords (object-cover)
                // Mirror X: browser shows webcam mirrored (like a real mirror),
                // but raw pixel data is unmirrored. Flip X so box lands on the face.
                const dx_raw = vx * coverScale - offX;
                const dw = vw * coverScale;
                const dx = dispW - dx_raw - dw;
                const dy = vy * coverScale - offY;
                const dh = vh * coverScale;

                const isKnown   = !!b.name && b.name !== 'Detecting...' && b.name !== 'Unknown';
                const isUnknown = b.name === 'Unknown';
                const color   = isKnown ? '#22d3ee' : isUnknown ? '#ef4444' : '#f97316';
                const bgColor = isKnown ? 'rgba(34,211,238,0.08)' : isUnknown ? 'rgba(239,68,68,0.08)' : 'rgba(249,115,22,0.08)';

                ctx.fillStyle = bgColor;
                ctx.fillRect(dx, dy, dw, dh);

                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';
                const arm = Math.min(dw, dh) * 0.22;
                ctx.beginPath();
                ctx.moveTo(dx, dy + arm); ctx.lineTo(dx, dy); ctx.lineTo(dx + arm, dy);
                ctx.moveTo(dx + dw - arm, dy); ctx.lineTo(dx + dw, dy); ctx.lineTo(dx + dw, dy + arm);
                ctx.moveTo(dx + dw, dy + dh - arm); ctx.lineTo(dx + dw, dy + dh); ctx.lineTo(dx + dw - arm, dy + dh);
                ctx.moveTo(dx + arm, dy + dh); ctx.lineTo(dx, dy + dh); ctx.lineTo(dx, dy + dh - arm);
                ctx.stroke();

                const label = isKnown ? `${b.name}  ${Math.round(b.conf * 100)}%`
                            : isUnknown ? 'Unknown' : 'Detecting...';
                ctx.font = 'bold 12px Inter, system-ui, sans-serif';
                const tw = ctx.measureText(label).width;
                const lx = Math.max(0, Math.min(dx, dispW - tw - 16));
                const ly = dy > 28 ? dy - 28 : dy + dh + 4;

                ctx.fillStyle = isKnown ? 'rgba(34,211,238,0.95)' : isUnknown ? 'rgba(239,68,68,0.95)' : 'rgba(249,115,22,0.95)';
                ctx.beginPath();
                ctx.roundRect(lx, ly, tw + 16, 24, 6);
                ctx.fill();
                ctx.fillStyle = '#000';
                ctx.fillText(label, lx + 8, ly + 16);
            });

            if (active) rafRef.current = requestAnimationFrame(drawLoop);
        };

        drawLoop();
        return () => { active = false; cancelAnimationFrame(rafRef.current); };
    }, [cameraActive]);



    // WebSocket: send full-frame snapshot -> Python -> store raw SNAP-coord boxes
    useEffect(() => {
        let ws: WebSocket;
        let interval: ReturnType<typeof setInterval>;

        const capture = () => {
            const video = videoRef.current;
            const snap  = snapRef.current;
            // Strict back-pressure: wait until previous frame is processed by the server
            if (!video || !snap || video.readyState < 4 || sendingRef.current) return;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            // Full frame (no crop) -> Python sees same view as display
            snap.width  = SNAP_W;
            snap.height = SNAP_H;
            const ctx = snap.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(video, 0, 0, SNAP_W, SNAP_H);
            sendingRef.current = true;
            snap.toBlob(blob => {
                if (blob && ws.readyState === WebSocket.OPEN) {
                    ws.send(blob);
                } else {
                    sendingRef.current = false; // Reset if send fails
                }
            }, 'image/jpeg', 0.6);
        };

        const connect = () => {
            ws = new WebSocket('ws://localhost:8082/ws/live-detect');
            wsRef.current = ws;
            // Send frames at 15 FPS (~66ms interval)
            ws.onopen    = () => { interval = setInterval(capture, 66); };
            ws.onmessage = (evt) => {
                sendingRef.current = false; // Reset back-pressure flag when server responds!
                try {
                    const data = JSON.parse(evt.data);
                    const raw  = (data.boxes || []) as FaceBox[];
                    if (raw.length > 0) {
                        // Non-empty: update immediately and cancel any pending clear
                        pythonBoxesRef.current = raw;
                        if (clearBoxTimerRef.current) {
                            clearTimeout(clearBoxTimerRef.current);
                            clearBoxTimerRef.current = null;
                        }
                    } else {
                        // Empty: only clear boxes after 500ms of continuous empty responses
                        if (!clearBoxTimerRef.current) {
                            clearBoxTimerRef.current = setTimeout(() => {
                                pythonBoxesRef.current = [];
                                clearBoxTimerRef.current = null;
                            }, 500);
                        }
                    }

                    const currentNames = new Set<string>(raw.filter(b => b.name && b.name !== 'Detecting...' && b.name !== 'Unknown').map(b => b.name));
                    prevNamesRef.current.forEach(name => {
                        if (!currentNames.has(name) && !leaveTimersRef.current.has(name)) {
                            // Log only after 3 minutes of continuous absence (box disappears immediately)
                            const t = setTimeout(() => { leaveTimersRef.current.delete(name); addActivityLog(`${name} left camera view`, 'LEAVE'); }, 180_000);
                            leaveTimersRef.current.set(name, t);
                        }
                    });
                    currentNames.forEach(name => {
                        if (leaveTimersRef.current.has(name)) { clearTimeout(leaveTimersRef.current.get(name)!); leaveTimersRef.current.delete(name); }
                        if (!prevNamesRef.current.has(name)) addActivityLog(`${name} entered camera view`, 'ENTER');
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
            leaveTimersRef.current.forEach(t => clearTimeout(t));
            if (clearBoxTimerRef.current) clearTimeout(clearBoxTimerRef.current);
        };
    }, [addActivityLog]);

    // ── Presence data + socket ──
    useEffect(() => {
        const load = async () => {
            if (!lectureId) return;
            try {
                setLoading(true);
                const res = await fetchWithAuth(`/door/presence/${lectureId}`);
                if (res.success) { setPresenceData(res.data.students || []); setPresenceStats(res.data.stats || null); }
                const resLogs = await fetchWithAuth(`/door/lecture/${lectureId}`);
                if (resLogs.success && resLogs.data?.students) {
                    const evts: ActivityLog[] = [];
                    resLogs.data.students.forEach((s: any) => {
                        let cur: string | null = null;
                        s.events.forEach((ev: any) => {
                            const ts = new Date(ev.timestamp);
                            if ((ev.type === 'SEEN' || ev.type === 'ENTRY') && cur !== 'SEEN') { cur = 'SEEN'; evts.push({ id: Math.random().toString(36).slice(2), message: `${s.student.fullName} entered`, type: 'ENTER', timestamp: ts }); }
                            else if ((ev.type === 'ABSENT' || ev.type === 'EXIT') && cur === 'SEEN') { cur = 'ABSENT'; evts.push({ id: Math.random().toString(36).slice(2), message: `${s.student.fullName} left`, type: 'LEAVE', timestamp: ts }); }
                        });
                    });
                    evts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
                    setActivityLogs(evts.slice(0, 50));
                }
            } catch {} finally { setLoading(false); }
        };
        load();
        if (!sectionId) return;
        const socket = socketService.connect();
        socket.emit('join_section', sectionId);
        const onPresence = (p: any) => {
            const pLid = p.lectureId?.toString?.() ?? p.lectureId;
            const oLid = lectureId?.toString?.() ?? lectureId;
            if (pLid && oLid && pLid !== oLid) return;
            setCameraActive(true);
            if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
            cameraTimerRef.current = setTimeout(() => setCameraActive(false), 30000);
            setPresenceData(prev => {
                const existing = prev.find(s => s.student._id.toString() === p.studentId.toString());
                const prevStatus = existing?.currentStatus ?? null;
                if (p.status === 'SEEN' && prevStatus !== 'SEEN') addActivityLog(`${p.studentName} entered the classroom`, 'ENTER');
                else if (p.status === 'ABSENT' && prevStatus === 'SEEN') addActivityLog(`${p.studentName} left (absent)`, 'LEAVE');
                const updated: PresenceStudent = {
                    student: existing?.student || { _id: p.studentId, fullName: p.studentName, prn: p.studentPrn },
                    currentStatus: p.status, lastSeen: p.status === 'SEEN' ? p.timestamp : (existing?.lastSeen || null),
                    lastConfidence: p.confidence || 0, totalPresentMinutes: p.totalPresentMinutes,
                    attendancePercentage: p.attendancePercentage, currentlyPresent: p.status === 'SEEN',
                };
                const list = existing ? prev.map(s => s.student._id.toString() === p.studentId.toString() ? updated : s) : [...prev, updated];
                setPresenceStats(ps => ps ? { ...ps, present: list.filter(s=>s.currentlyPresent).length, absent: list.filter(s=>s.currentStatus==='ABSENT').length, unseen: list.filter(s=>!s.currentStatus).length } : ps);
                return list;
            });
        };
        socket.on('presence:update', onPresence);
        return () => { socket.off('presence:update', onPresence); if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current); };
    }, [lectureId, sectionId, addActivityLog]);

    return (
        <div className="relative glass-card p-6 rounded-[28px] space-y-5 overflow-hidden">
            {/* Ambient glows */}
            <div className="absolute -top-12 -right-12 w-48 h-48 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-blue-500/10 rounded-full blur-[80px] pointer-events-none" />

            {/* ── Header ── */}
            <div className="relative z-10 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                    {cameraActive
                        ? <div className="relative"><div className="absolute w-8 h-8 bg-cyan-400/30 rounded-full animate-ping" /><Activity className="w-6 h-6 text-cyan-400 relative z-10" /></div>
                        : <WifiOff className="w-6 h-6 text-white/40" />}
                </div>
                <div>
                    <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-black tracking-tight text-white">Live Classroom</h2>
                        <span className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-widest rounded-full border ${cameraActive ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 animate-pulse' : 'bg-white/5 text-white/30 border-white/10'}`}>
                            {cameraActive ? 'Live Feed Active' : 'Waiting for camera'}
                        </span>
                    </div>
                    <p className="text-sm text-white/50 font-medium mt-0.5">
                        {activeSession?.courseId?.courseName} · Room {roomNumber || 'Unknown'}
                        {modelsLoaded && <span className="ml-2 text-emerald-400/70 text-xs">· AI Ready</span>}
                    </p>
                </div>
            </div>

            {/* ── Main content ── */}
            <div className="relative z-10 space-y-4">
                {loading && (
                    <div className="py-12 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
                        <p className="text-sm text-white/40 font-medium animate-pulse">Connecting to live feed...</p>
                    </div>
                )}

                {/* ── Camera + Canvas ── */}
                <div className={`relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl ${loading ? 'hidden' : 'block'}`}>
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} onLoadedMetadata={() => setCameraActive(true)} />
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

                    {/* Start camera overlay */}
                    {!cameraActive && !camError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-2">
                                <Camera className="w-8 h-8 text-cyan-400" />
                            </div>
                            <button onClick={startCamera} className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-black text-sm transition-all hover:scale-105 shadow-lg">
                                🎥 Start Camera
                            </button>
                            <p className="text-white/30 text-xs">Camera runs locally — no video sent to server</p>
                        </div>
                    )}

                    {/* Error overlay */}
                    {camError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 gap-3">
                            <WifiOff className="w-8 h-8 text-red-400" />
                            <p className="text-white/80 font-bold text-sm text-center px-4">{camError}</p>
                        </div>
                    )}

                    {/* LIVE badge */}
                    {cameraActive && (
                        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-black/70 text-white/90 border border-cyan-500/30 backdrop-blur-sm flex items-center gap-1.5 z-20">
                            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            LIVE · AI Detection
                        </div>
                    )}

                    {/* Model loading badge */}
                    {!modelsLoaded && cameraActive && (
                        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 backdrop-blur-sm flex items-center gap-1.5 z-20">
                            <Loader2 className="w-3 h-3 animate-spin" /> Loading AI models...
                        </div>
                    )}
                </div>

                {/* ── Stats + Students ── */}
                <div className={`space-y-4 ${loading ? 'hidden' : 'block'}`}>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: 'In Room', value: presenceStats?.present || 0, color: 'cyan' },
                            { label: 'Absent',  value: presenceStats?.absent  || 0, color: 'red' },
                            { label: 'Unseen',  value: presenceStats?.unseen  || 0, color: 'white' },
                        ].map(({ label, value, color }) => (
                            <div key={label} className={`flex items-center gap-3 p-4 rounded-2xl ${color === 'cyan' ? 'bg-cyan-500/5 border border-cyan-500/10' : color === 'red' ? 'bg-red-500/5 border border-red-500/10' : 'bg-white/5 border border-white/5'}`}>
                                <div className={`w-1.5 h-8 rounded-full ${color === 'cyan' ? 'bg-cyan-400' : color === 'red' ? 'bg-red-400' : 'bg-white/20'}`} />
                                <div>
                                    <p className="text-2xl font-black text-white">{value}</p>
                                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{label}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Student avatar grid */}
                    <div className="p-5 rounded-2xl bg-black/40 border border-white/5">
                        <div className="flex flex-wrap gap-2">
                            {[...presenceData]
                                .sort((a, b) => ((( { SEEN: 0, ABSENT: 2 } as any)[a.currentStatus ?? ''] ?? 1) - (( { SEEN: 0, ABSENT: 2 } as any)[b.currentStatus ?? ''] ?? 1)))
                                .map(entry => {
                                    const isPresent = entry.currentlyPresent;
                                    const isAbsent  = entry.currentStatus === 'ABSENT';
                                    return (
                                        <div key={entry.student._id} className="relative group cursor-default">
                                            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                                                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black border-2 transition-all duration-300 ${isPresent ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)] hover:scale-110' : isAbsent ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:scale-110' : 'bg-white/5 border-white/10 text-white/30'}`}>
                                                {entry.student.fullName?.charAt(0).toUpperCase()}
                                            </motion.div>
                                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-black/90 border border-white/10 text-xs font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                                                {entry.student.fullName}
                                                <div className="text-[10px] text-white/50 mt-0.5">{isPresent ? 'In Room' : isAbsent ? 'Absent' : 'Unseen'}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Activity Log ── */}
            <div className="relative z-10 rounded-2xl bg-black/40 border border-white/10 overflow-hidden flex flex-col h-56">
                <div className="flex items-center gap-3 px-5 py-3 bg-white/5 border-b border-white/5">
                    <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                        <Users className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">Student Activity Log</h3>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">Real-time Presence Events</p>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {activityLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20">
                            <Activity className="w-7 h-7 opacity-30" />
                            <p className="text-sm font-medium">No activity yet</p>
                        </div>
                    ) : (
                        <AnimatePresence>
                            {activityLogs.map(log => (
                                <motion.div key={log.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} layout
                                    className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/3 border border-white/5 hover:bg-white/5 transition-colors">
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${log.type === 'ENTER' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse' : 'bg-red-500'}`} />
                                    <span className={`text-sm font-semibold flex-1 ${log.type === 'ENTER' ? 'text-emerald-200' : 'text-red-200/80'}`}>{log.message}</span>
                                    <span className="text-[10px] text-white/30 font-bold shrink-0">{log.timestamp.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>
        </div>
    );
}
