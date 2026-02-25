'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MapPin, Camera, ShieldCheck, AlertTriangle, CheckCircle2,
    Loader2, Navigation, RefreshCw, BookOpen, ChevronDown,
    Lock, Satellite
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

/* ── Types ──────────────────────────────────────────────────────────────────── */
interface GpsState {
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    timestamp: number | null;
    loading: boolean;
    error: string | null;
}

type Step = 'select' | 'gps' | 'photo' | 'done';

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function accuracyLabel(acc: number | null) {
    if (acc === null) return '—';
    if (acc <= 10) return `${acc.toFixed(0)} m (Excellent)`;
    if (acc <= 30) return `${acc.toFixed(0)} m (Good)`;
    if (acc <= 80) return `${acc.toFixed(0)} m (Fair)`;
    return `${acc.toFixed(0)} m (Too Low)`;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   GPS ATTENDANCE PAGE — Teachers only
   Flow: select lecture → fix GPS → live photo → submit → done
═══════════════════════════════════════════════════════════════════════════════ */
export default function TeacherGpsAttendancePage() {
    const webcamRef = useRef<Webcam>(null);

    const [sections, setSections] = useState<any[]>([]);
    const [lectures, setLectures] = useState<any[]>([]);
    const [selectedSection, setSelectedSection] = useState<string>('');
    const [selectedLecture, setSelectedLecture] = useState<string>('');
    const [loadingLectures, setLoadingLectures] = useState(false);

    const [step, setStep] = useState<Step>('select');
    const [gps, setGps] = useState<GpsState>({ lat: null, lng: null, accuracy: null, timestamp: null, loading: false, error: null });
    const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);

    // Set-classroom-location state
    const [showSetLocation, setShowSetLocation] = useState(false);
    const [settingLocation, setSettingLocation] = useState(false);

    /* Load sections ─────────────────────────────────────────────────────────── */
    useEffect(() => {
        fetchWithAuth('/sections/teacher')
            .then(r => setSections(r.data?.sections || []))
            .catch(() => toast.error('Failed to load classrooms'));
    }, []);

    /* Load lectures for selected section ───────────────────────────────────── */
    useEffect(() => {
        if (!selectedSection) { setLectures([]); setSelectedLecture(''); return; }
        setLoadingLectures(true);
        fetchWithAuth(`/sections/${selectedSection}/lectures`)
            .then(r => setLectures((r.data?.lectures || []).filter((l: any) => l.status === 'ONGOING')))
            .catch(() => toast.error('Failed to load sessions'))
            .finally(() => setLoadingLectures(false));
    }, [selectedSection]);

    /* GPS fix ──────────────────────────────────────────────────────────────── */
    const acquireGps = useCallback(() => {
        if (!navigator.geolocation) {
            setGps(g => ({ ...g, error: 'Geolocation not supported on this device.', loading: false }));
            return;
        }
        setGps(g => ({ ...g, loading: true, error: null }));

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setGps({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    timestamp: pos.timestamp,
                    loading: false,
                    error: null,
                });
            },
            (err) => {
                const msgs: Record<number, string> = {
                    1: 'Location permission denied. Please allow in browser settings.',
                    2: 'Location unavailable. Move outdoors and retry.',
                    3: 'GPS timed out. Retry when signal is stronger.',
                };
                setGps(g => ({ ...g, loading: false, error: msgs[err.code] || err.message }));
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }, []);

    /* Auto-acquire GPS when step changes to 'gps' ──────────────────────────── */
    useEffect(() => {
        if (step === 'gps') acquireGps();
    }, [step, acquireGps]);

    /* Capture live photo ────────────────────────────────────────────────────── */
    const capturePhoto = () => {
        const img = webcamRef.current?.getScreenshot({ width: 960, height: 720 });
        if (img) setCapturedPhoto(img);
        else toast.error('Could not capture photo. Check camera permissions.');
    };

    /* Submit GPS attendance ─────────────────────────────────────────────────── */
    const submit = async () => {
        if (!gps.lat || !gps.lng || !capturedPhoto || !selectedLecture) return;
        if ((gps.accuracy ?? 999) > 150) {
            toast.error('GPS accuracy is too low. Move outdoors and retry.');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetchWithAuth('/gps-attendance/mark', {
                method: 'POST',
                body: JSON.stringify({
                    lectureId: selectedLecture,
                    lat: gps.lat,
                    lng: gps.lng,
                    accuracy: gps.accuracy,
                    timestamp: gps.timestamp,
                    clientTime: Date.now(),
                    livePhoto: capturedPhoto,
                }),
            });

            if (res.success) {
                setResult(res.data);
                setStep('done');
                toast.success(res.message || 'Attendance marked!');
            }
        } catch (err: any) {
            toast.error(err.message || 'GPS attendance failed');
        } finally {
            setSubmitting(false);
        }
    };

    /* Save classroom location ─────────────────────────────────────────────── */
    const saveClassroomLocation = async () => {
        if (!selectedSection || !gps.lat || !gps.lng) {
            toast.error('Select a classroom and get a GPS fix first');
            return;
        }
        setSettingLocation(true);
        try {
            const res = await fetchWithAuth(`/gps-attendance/set-location/${selectedSection}`, {
                method: 'PATCH',
                body: JSON.stringify({ lat: gps.lat, lng: gps.lng, radiusMeters: 50 }),
            });
            if (res.success) {
                toast.success(`📍 Classroom location saved!\n${gps.lat?.toFixed(5)}, ${gps.lng?.toFixed(5)}`);
                setShowSetLocation(false);
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to save location');
        } finally {
            setSettingLocation(false);
        }
    };

    const canProceedFromSelect = selectedSection && selectedLecture;
    const gpsOk = gps.lat && gps.lng && !gps.loading && !gps.error && (gps.accuracy ?? 999) <= 150;

    /* ═══ RENDER ════════════════════════════════════════════════════════════ */
    return (
        <DashboardLayout>
            <div className="max-w-2xl mx-auto space-y-8">

                {/* Header */}
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                            <Navigation className="w-5 h-5 text-emerald-400" />
                        </div>
                        <h1 className="text-4xl font-black tracking-tight text-gradient">GPS Attendance</h1>
                    </div>
                    <p className="text-white/40 text-sm">Mark classroom attendance using your real-time GPS location + live photo.</p>
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-2">
                    {(['select', 'gps', 'photo', 'done'] as Step[]).map((s, i) => (
                        <React.Fragment key={s}>
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${step === s ? 'bg-emerald-500 text-white' :
                                    ['select', 'gps', 'photo', 'done'].indexOf(step) > i ? 'bg-emerald-500/20 text-emerald-400' :
                                        'bg-white/5 text-white/30'
                                }`}>
                                <span>{i + 1}</span>
                                <span className="hidden sm:block">{s === 'select' ? 'Session' : s === 'gps' ? 'GPS Fix' : s === 'photo' ? 'Live Photo' : 'Done'}</span>
                            </div>
                            {i < 3 && <div className="flex-1 h-px bg-white/10" />}
                        </React.Fragment>
                    ))}
                </div>

                <AnimatePresence mode="wait">

                    {/* ── STEP 1: Select session ──────────────────────────────────────── */}
                    {step === 'select' && (
                        <motion.div key="select" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] space-y-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <BookOpen className="w-5 h-5 text-primary" /> Select Your Session
                            </h2>

                            {/* Classroom */}
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">Classroom</label>
                                <div className="relative">
                                    <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)}
                                        className="appearance-none w-full bg-white/5 border border-white/10 text-sm text-white px-5 py-4 pr-10 rounded-2xl focus:outline-none focus:border-primary/40 cursor-pointer">
                                        <option value="">Select a classroom…</option>
                                        {sections.map(s => (
                                            <option key={s._id} value={s._id}>
                                                {s.courseId?.courseName || s.sectionName} — {s.sectionName}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                                </div>
                            </div>

                            {/* Active lecture */}
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">
                                    Active Session {selectedSection && <span className="text-primary/60">(ONGOING only)</span>}
                                </label>
                                <div className="relative">
                                    {loadingLectures ? (
                                        <div className="flex items-center gap-3 px-5 py-4 bg-white/5 border border-white/10 rounded-2xl">
                                            <Loader2 className="w-4 h-4 animate-spin text-white/30" />
                                            <span className="text-sm text-white/30">Loading sessions…</span>
                                        </div>
                                    ) : (
                                        <>
                                            <select value={selectedLecture} onChange={e => setSelectedLecture(e.target.value)}
                                                className="appearance-none w-full bg-white/5 border border-white/10 text-sm text-white px-5 py-4 pr-10 rounded-2xl focus:outline-none focus:border-primary/40 cursor-pointer">
                                                <option value="">
                                                    {!selectedSection ? 'Select a classroom first' :
                                                        lectures.length === 0 ? 'No ongoing sessions found' :
                                                            'Select a session…'}
                                                </option>
                                                {lectures.map(l => (
                                                    <option key={l._id} value={l._id}>{l.topic || 'Session'} — started {new Date(l.scheduledStart).toLocaleTimeString('en-IN')}</option>
                                                ))}
                                            </select>
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                                        </>
                                    )}
                                </div>
                                {selectedSection && lectures.length === 0 && !loadingLectures && (
                                    <p className="text-xs text-amber-400 mt-2 flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5" /> Start a live session first from the Sessions page.
                                    </p>
                                )}
                            </div>

                            {/* Classroom location tools */}
                            <div className="pt-2 border-t border-white/5">
                                <button onClick={() => { setShowSetLocation(v => !v); if (!gps.lat) acquireGps(); }}
                                    className="text-xs text-white/30 hover:text-white/60 transition-colors flex items-center gap-1.5">
                                    <MapPin className="w-3.5 h-3.5" />
                                    {showSetLocation ? 'Cancel' : 'Set / Update classroom GPS coordinates'}
                                </button>
                                {showSetLocation && (
                                    <div className="mt-4 p-4 rounded-2xl bg-white/3 border border-white/8 space-y-3">
                                        <p className="text-xs text-white/50">Stand in the classroom, get a GPS fix, then save it as the reference coordinates (50 m radius).</p>
                                        {gps.lat ? (
                                            <p className="text-xs font-mono text-emerald-400">📍 {gps.lat.toFixed(6)}, {gps.lng?.toFixed(6)} · accuracy {gps.accuracy?.toFixed(0)} m</p>
                                        ) : (
                                            <button onClick={acquireGps} className="text-xs text-primary hover:underline flex items-center gap-1.5">
                                                <Satellite className="w-3.5 h-3.5" /> Get GPS fix first
                                            </button>
                                        )}
                                        <button onClick={saveClassroomLocation} disabled={settingLocation || !gps.lat}
                                            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-xl text-xs font-bold uppercase tracking-widest text-white transition-all">
                                            {settingLocation ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : <><MapPin className="w-3.5 h-3.5" />Save Location</>}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <button onClick={() => setStep('gps')} disabled={!canProceedFromSelect}
                                className="w-full py-4 bg-primary hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                <Navigation className="w-4 h-4" /> Next: Get GPS Fix
                            </button>
                        </motion.div>
                    )}

                    {/* ── STEP 2: GPS fix ─────────────────────────────────────────────── */}
                    {step === 'gps' && (
                        <motion.div key="gps" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] space-y-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Satellite className="w-5 h-5 text-emerald-400" /> GPS Location Fix
                            </h2>
                            <p className="text-sm text-white/40">Your GPS coordinates are captured by the browser directly — not from photo metadata. This cannot be spoofed by the camera roll.</p>

                            {/* GPS status card */}
                            <div className={`p-6 rounded-2xl border space-y-4 transition-all ${gps.error ? 'bg-rose-500/5 border-rose-500/20' :
                                    gpsOk ? 'bg-emerald-500/5 border-emerald-500/20' :
                                        'bg-white/3 border-white/10'
                                }`}>
                                {gps.loading ? (
                                    <div className="flex items-center gap-3 text-white/60">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span className="text-sm font-medium">Acquiring GPS signal…</span>
                                    </div>
                                ) : gps.error ? (
                                    <div className="flex items-start gap-3 text-rose-400">
                                        <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
                                        <span className="text-sm">{gps.error}</span>
                                    </div>
                                ) : gps.lat ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-emerald-400">
                                            <CheckCircle2 className="w-5 h-5" />
                                            <span className="text-sm font-bold">GPS Fix Acquired</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { label: 'Latitude', value: gps.lat.toFixed(6) },
                                                { label: 'Longitude', value: gps.lng?.toFixed(6) || '—' },
                                                { label: 'Accuracy', value: accuracyLabel(gps.accuracy) },
                                                { label: 'Fixed At', value: new Date(gps.timestamp || 0).toLocaleTimeString('en-IN') },
                                            ].map(f => (
                                                <div key={f.label} className="bg-white/5 rounded-xl p-3">
                                                    <p className="text-[9px] font-black uppercase tracking-widest text-white/30">{f.label}</p>
                                                    <p className="text-sm font-mono text-white mt-0.5">{f.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                        {(gps.accuracy ?? 999) > 150 && (
                                            <div className="flex items-center gap-2 text-amber-400 text-xs">
                                                <AlertTriangle className="w-4 h-4" />
                                                Accuracy too low (&gt;150 m). Move outdoors or to a window and retry.
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-white/30">Tap below to start the GPS fix.</p>
                                )}
                            </div>

                            {/* Anti-spoofing notice */}
                            <div className="flex items-start gap-3 p-4 rounded-2xl bg-primary/5 border border-primary/15">
                                <Lock className="w-4 h-4 text-primary/60 mt-0.5 shrink-0" />
                                <p className="text-xs text-white/40">
                                    Anti-spoofing: The server verifies GPS freshness (≤60 s), accuracy (≤150 m), coordinate validity, and request timing. Replayed or faked GPS requests are rejected.
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => setStep('select')} className="px-6 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold transition-all">Back</button>
                                <button onClick={acquireGps} className="px-6 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold transition-all flex items-center gap-2">
                                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                                </button>
                                <button onClick={() => setStep('photo')} disabled={!gpsOk}
                                    className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                    <Camera className="w-4 h-4" /> Next: Live Photo
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* ── STEP 3: Live photo ─────────────────────────────────────────── */}
                    {step === 'photo' && (
                        <motion.div key="photo" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] space-y-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Camera className="w-5 h-5 text-primary" /> Live Classroom Photo
                            </h2>
                            <p className="text-sm text-white/40">
                                Take a live photo of the classroom. Gallery upload is disabled — only live camera captures are accepted.
                            </p>

                            {/* GPS summary chip */}
                            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full w-fit">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-400">GPS ✓ {gps.lat?.toFixed(5)}, {gps.lng?.toFixed(5)} · {gps.accuracy?.toFixed(0)} m accuracy</span>
                            </div>

                            {!capturedPhoto ? (
                                <div className="space-y-4">
                                    <div className="relative rounded-[28px] overflow-hidden aspect-video bg-black border border-white/10">
                                        <Webcam
                                            ref={webcamRef}
                                            audio={false}
                                            screenshotFormat="image/jpeg"
                                            screenshotQuality={0.85}
                                            className="w-full h-full object-cover"
                                            videoConstraints={{ facingMode: 'environment', width: 960, height: 720 }}
                                        />
                                        {/* Overlay corners */}
                                        <div className="absolute top-4 left-4 w-10 h-10 border-t-2 border-l-2 border-primary/50 rounded-tl-xl" />
                                        <div className="absolute top-4 right-4 w-10 h-10 border-t-2 border-r-2 border-primary/50 rounded-tr-xl" />
                                        <div className="absolute bottom-4 left-4 w-10 h-10 border-b-2 border-l-2 border-primary/50 rounded-bl-xl" />
                                        <div className="absolute bottom-4 right-4 w-10 h-10 border-b-2 border-r-2 border-primary/50 rounded-br-xl" />
                                        {/* Live badge */}
                                        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 bg-rose-500/90 rounded-full">
                                            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                            <span className="text-[10px] font-black text-white">LIVE</span>
                                        </div>
                                    </div>
                                    <button onClick={capturePhoto}
                                        className="w-full py-5 bg-primary hover:bg-primary/80 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                        <Camera className="w-5 h-5" /> Capture Classroom Photo
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="relative rounded-[28px] overflow-hidden aspect-video bg-black border border-emerald-500/30">
                                        <img src={capturedPhoto} alt="Classroom" className="w-full h-full object-cover" />
                                        <div className="absolute top-4 right-4 bg-emerald-500/90 backdrop-blur rounded-full px-3 py-1.5 flex items-center gap-1.5">
                                            <CheckCircle2 className="w-4 h-4 text-white" />
                                            <span className="text-[10px] font-black text-white">CAPTURED</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <button onClick={() => setCapturedPhoto(null)}
                                            className="flex-1 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2">
                                            <RefreshCw className="w-3.5 h-3.5" /> Retake
                                        </button>
                                        <button onClick={submit} disabled={submitting}
                                            className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                            {submitting
                                                ? <><Loader2 className="w-4 h-4 animate-spin" />Verifying…</>
                                                : <><ShieldCheck className="w-4 h-4" />Submit & Mark</>
                                            }
                                        </button>
                                    </div>
                                </div>
                            )}

                            <button onClick={() => setStep('gps')} className="text-xs text-white/20 hover:text-white/40 transition-colors">← Back to GPS</button>
                        </motion.div>
                    )}

                    {/* ── STEP 4: Success ─────────────────────────────────────────────── */}
                    {step === 'done' && result && (
                        <motion.div key="done" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                            className="glass-card p-10 rounded-[35px] text-center space-y-6 border border-emerald-500/20 bg-emerald-500/5">
                            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/40">
                                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-emerald-400">Attendance Marked!</h2>
                                <p className="text-white/50 text-sm mt-2">GPS verification successful. Server timestamp recorded.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-left">
                                {[
                                    { label: 'Distance', value: `${result.distance ?? '—'} m from classroom` },
                                    { label: 'Server Time', value: result.serverTimestamp ? new Date(result.serverTimestamp).toLocaleTimeString('en-IN') : '—' },
                                    { label: 'GPS Lat / Lng', value: `${result.record?.gpsVerification?.lat?.toFixed(5)}, ${result.record?.gpsVerification?.lng?.toFixed(5)}` },
                                    { label: 'Method', value: 'GPS + Live Photo' },
                                ].map(f => (
                                    <div key={f.label} className="bg-white/5 rounded-2xl p-4">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-white/30">{f.label}</p>
                                        <p className="text-sm font-bold mt-0.5">{f.value}</p>
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => { setStep('select'); setResult(null); setCapturedPhoto(null); setGps({ lat: null, lng: null, accuracy: null, timestamp: null, loading: false, error: null }); }}
                                className="px-8 py-4 bg-white/10 hover:bg-white/20 rounded-2xl text-sm font-bold transition-all">
                                Mark Another Session
                            </button>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        </DashboardLayout>
    );
}
