'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MapPin, Camera, ShieldCheck, AlertTriangle, CheckCircle2,
    Loader2, Navigation, RefreshCw, BookOpen, ChevronDown,
    Lock, Satellite, Scan, UserCheck
} from 'lucide-react';
import Webcam from 'react-webcam';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';

/* ── Types ──────────────────────────────────────────────────────────────────── */
interface GpsState {
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    timestamp: number | null;
    loading: boolean;
    error: string | null;
}

// Added 'face' step between 'gps' and 'photo'
type Step = 'select' | 'gps' | 'face' | 'photo' | 'done';

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function accuracyLabel(acc: number | null) {
    if (acc === null) return '—';
    if (acc <= 10) return `${acc.toFixed(0)} m (Excellent)`;
    if (acc <= 30) return `${acc.toFixed(0)} m (Good)`;
    if (acc <= 80) return `${acc.toFixed(0)} m (Fair)`;
    return `${acc.toFixed(0)} m (Too Low)`;
}

const STEPS: Step[] = ['select', 'gps', 'face', 'photo', 'done'];
const STEP_LABELS: Record<Step, string> = {
    select: '1. Session',
    gps: '2. GPS',
    face: '3. Face',
    photo: '4. Photo',
    done: '✓ Done',
};

/* ═══════════════════════════════════════════════════════════════════════════════
   GPS ATTENDANCE PAGE — Teachers only
   Flow: select lecture → fix GPS → face scan → live photo → submit → done
═══════════════════════════════════════════════════════════════════════════════ */
export default function TeacherGpsAttendancePage() {
    const router = useRouter();
    const webcamRef = useRef<Webcam>(null);

    const [sections, setSections] = useState<any[]>([]);
    const [lectures, setLectures] = useState<any[]>([]);
    const [selectedSection, setSelectedSection] = useState<string>('');
    const [selectedLecture, setSelectedLecture] = useState<string>('');
    const [loadingLectures, setLoadingLectures] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);

    const [step, setStep] = useState<Step>('select');
    const [gps, setGps] = useState<GpsState>({ lat: null, lng: null, accuracy: null, timestamp: null, loading: false, error: null });

    // Face scan state
    const [capturedFace, setCapturedFace] = useState<string | null>(null);
    const [faceVerifying, setFaceVerifying] = useState(false);
    const [faceVerified, setFaceVerified] = useState(false);
    const [faceError, setFaceError] = useState<string | null>(null);

    const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);

    // Set-classroom-location state
    const [showSetLocation, setShowSetLocation] = useState(false);
    const [settingLocation, setSettingLocation] = useState(false);

    /* Load sections + current user ─────────────────────────────────────────── */
    useEffect(() => {
        fetchWithAuth('/sections/teacher')
            .then(r => setSections(r.data?.sections || []))
            .catch(() => toast.error('Failed to load classrooms'));

        fetchWithAuth('/auth/me')
            .then(r => setCurrentUser(r.data?.user))
            .catch(() => { });
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

    /* Capture face scan ────────────────────────────────────────────────────── */
    const captureFaceScan = () => {
        const img = webcamRef.current?.getScreenshot({ width: 640, height: 480 });
        if (img) {
            setCapturedFace(img);
            setFaceError(null);
            setFaceVerified(false);
        } else {
            toast.error('Could not capture face. Check camera permissions.');
        }
    };

    /* Verify captured face against server ─────────────────────────────────── */
    const verifyFace = async () => {
        if (!capturedFace) { toast.error('Capture your face first'); return; }
        setFaceVerifying(true);
        setFaceError(null);
        try {
            const res = await fetchWithAuth('/biometric/face/verify', {
                method: 'POST',
                body: JSON.stringify({ faceImage: capturedFace }),
            });
            if (res.data?.verified) {
                setFaceVerified(true);
                toast.success(`✅ Face verified! (${(res.data.confidence * 100).toFixed(0)}% match)`);
            } else {
                setFaceError('Face not recognised. Please look at the camera clearly and retake.');
                toast.error('Face verification failed.');
            }
        } catch (err: any) {
            setFaceError(err.message || 'Face verification error.');
            toast.error(err.message || 'Face verification error');
        } finally {
            setFaceVerifying(false);
        }
    };

    /* Capture live classroom photo ───────────────────────────────────────── */
    const capturePhoto = () => {
        const img = webcamRef.current?.getScreenshot({ width: 960, height: 720 });
        if (img) setCapturedPhoto(img);
        else toast.error('Could not capture photo. Check camera permissions.');
    };

    /* Submit GPS attendance ─────────────────────────────────────────────────── */
    const submit = async () => {
        if (!gps.lat || !gps.lng || !capturedPhoto || !capturedFace || !selectedLecture) return;
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
                    faceImage: capturedFace,  // ← face image now sent to backend
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
    const faceNotRegistered = currentUser && !currentUser.faceRegisteredAt && !currentUser.faceImageUrl;

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
                    <p className="text-white/40 text-sm">Mark classroom attendance using GPS location + face scan + live photo.</p>
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-1 flex-wrap">
                    {STEPS.map((s, i) => (
                        <React.Fragment key={s}>
                            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${step === s
                                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                                : STEPS.indexOf(step) > i
                                    ? 'bg-white/10 text-white/60'
                                    : 'bg-white/5 text-white/20'
                                }`}>
                                {STEP_LABELS[s]}
                            </div>
                            {i < STEPS.length - 1 && <div className="w-3 h-px bg-white/10" />}
                        </React.Fragment>
                    ))}
                </div>

                {/* ── Face Not Registered Warning ─────────────────────────────── */}
                {faceNotRegistered && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-start gap-4 p-5 rounded-3xl bg-amber-500/5 border border-amber-500/20"
                    >
                        <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-bold text-amber-400 text-sm">Face Not Registered</p>
                            <p className="text-white/40 text-xs mt-1">
                                GPS attendance requires face verification. Please register your face in your Profile first.
                            </p>
                        </div>
                        <button
                            onClick={() => router.push('/teacher/profile')}
                            className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-bold rounded-xl transition-all shrink-0"
                        >
                            Go to Profile
                        </button>
                    </motion.div>
                )}

                <AnimatePresence mode="wait">

                    {/* ── STEP 1: Select Section & Lecture ───────────────────── */}
                    {step === 'select' && (
                        <motion.div key="select" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] border border-white/5 space-y-6">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <BookOpen className="w-5 h-5 text-emerald-400" /> Select Session
                                </h2>
                                <p className="text-white/40 text-xs mt-1">Choose the classroom section and the active lecture to mark GPS attendance for.</p>
                            </div>

                            {/* Section selector */}
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">Classroom</label>
                                <div className="relative">
                                    <select
                                        value={selectedSection}
                                        onChange={e => setSelectedSection(e.target.value)}
                                        className="w-full input-field appearance-none pr-10 text-sm"
                                    >
                                        <option value="">— Choose a classroom —</option>
                                        {sections.map((s: any) => (
                                            <option key={s._id} value={s._id}>
                                                {s.courseId?.courseCode ?? s.sectionName} · {s.courseId?.courseName ?? ''}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                                </div>
                            </div>

                            {/* Lecture selector */}
                            {selectedSection && (
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">
                                        Active Session
                                        {loadingLectures && <span className="ml-2 text-white/20">(loading…)</span>}
                                    </label>
                                    {!loadingLectures && lectures.length === 0 ? (
                                        <div className="p-4 rounded-2xl border border-white/5 text-center">
                                            <p className="text-xs text-white/30">No active sessions for this classroom.</p>
                                            <p className="text-xs text-white/20 mt-1">Start a session from the Sessions page first.</p>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <select
                                                value={selectedLecture}
                                                onChange={e => setSelectedLecture(e.target.value)}
                                                className="w-full input-field appearance-none pr-10 text-sm"
                                                disabled={loadingLectures}
                                            >
                                                <option value="">— Choose active session —</option>
                                                {lectures.map((l: any) => (
                                                    <option key={l._id} value={l._id}>
                                                        {l.topic || 'Active Session'} · {new Date(l.scheduledStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                    </option>
                                                ))}
                                            </select>
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={() => setStep('gps')}
                                disabled={!canProceedFromSelect || !!faceNotRegistered}
                                className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                            >
                                <Navigation className="w-4 h-4" /> Proceed to GPS Fix
                            </button>
                        </motion.div>
                    )}

                    {/* ── STEP 2: GPS Fix ────────────────────────────────────── */}
                    {step === 'gps' && (
                        <motion.div key="gps" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] border border-white/5 space-y-6">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Satellite className="w-5 h-5 text-emerald-400" /> GPS Location Fix
                                </h2>
                                <p className="text-white/40 text-xs mt-1">We need accurate GPS. Move near a window or outdoors for best results.</p>
                            </div>

                            {/* GPS status card */}
                            <div className={`p-6 rounded-[24px] border space-y-4 ${gps.error ? 'border-rose-500/20 bg-rose-500/5' : gpsOk ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/5 bg-white/3'}`}>
                                {gps.loading ? (
                                    <div className="flex items-center gap-4">
                                        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                                        <div>
                                            <p className="font-bold text-sm">Acquiring GPS…</p>
                                            <p className="text-xs text-white/30">This may take up to 15 seconds</p>
                                        </div>
                                    </div>
                                ) : gps.error ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3">
                                            <AlertTriangle className="w-6 h-6 text-rose-400" />
                                            <p className="text-sm font-bold text-rose-400">GPS Error</p>
                                        </div>
                                        <p className="text-xs text-white/50">{gps.error}</p>
                                        <button onClick={acquireGps} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold transition-all">
                                            <RefreshCw className="w-3 h-3" /> Retry
                                        </button>
                                    </div>
                                ) : gps.lat ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3">
                                            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                                            <p className="text-sm font-bold text-emerald-400">GPS Fixed</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 text-xs">
                                            <div className="p-3 bg-white/5 rounded-xl">
                                                <p className="text-white/30 uppercase text-[9px] font-black tracking-widest">Latitude</p>
                                                <p className="font-mono font-bold mt-1">{gps.lat.toFixed(6)}</p>
                                            </div>
                                            <div className="p-3 bg-white/5 rounded-xl">
                                                <p className="text-white/30 uppercase text-[9px] font-black tracking-widest">Longitude</p>
                                                <p className="font-mono font-bold mt-1">{gps.lng?.toFixed(6)}</p>
                                            </div>
                                            <div className="p-3 bg-white/5 rounded-xl col-span-2">
                                                <p className="text-white/30 uppercase text-[9px] font-black tracking-widest">Accuracy</p>
                                                <p className={`font-bold mt-1 ${(gps.accuracy ?? 999) <= 30 ? 'text-emerald-400' : (gps.accuracy ?? 999) <= 80 ? 'text-amber-400' : 'text-rose-400'}`}>
                                                    {accuracyLabel(gps.accuracy)}
                                                </p>
                                            </div>
                                        </div>
                                        <button onClick={acquireGps} className="flex items-center gap-2 text-xs text-white/30 hover:text-white/50 transition-colors">
                                            <RefreshCw className="w-3 h-3" /> Re-acquire
                                        </button>
                                    </div>
                                ) : (
                                    <div className="text-center py-4">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-400 mb-3" />
                                        <p className="text-sm text-white/40">Waiting for location…</p>
                                    </div>
                                )}
                            </div>

                            {/* Set classroom location helper */}
                            {gpsOk && (
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setShowSetLocation(v => !v)}
                                        className="flex items-center gap-2 text-xs text-white/30 hover:text-white/50 transition-colors"
                                    >
                                        <MapPin className="w-3 h-3" /> {showSetLocation ? 'Cancel' : 'Set classroom GPS to current location'}
                                    </button>
                                </div>
                            )}
                            {showSetLocation && gpsOk && (
                                <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 space-y-3">
                                    <p className="text-xs font-bold text-amber-400">📍 This will save your current GPS as the classroom location (50 m radius). Students must be within this radius to mark GPS attendance.</p>
                                    <button
                                        onClick={saveClassroomLocation}
                                        disabled={settingLocation}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-bold rounded-xl transition-all disabled:opacity-40"
                                    >
                                        {settingLocation ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                                        Save as Classroom Location
                                    </button>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button onClick={() => setStep('select')} className="px-5 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-xs font-bold transition-all">Back</button>
                                <button
                                    onClick={() => setStep('face')}
                                    disabled={!gpsOk}
                                    className="flex-1 py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                >
                                    <Scan className="w-4 h-4" /> Proceed to Face Scan
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* ── STEP 3: Face Scan (NEW) ─────────────────────────────── */}
                    {step === 'face' && (
                        <motion.div key="face" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] border border-primary/20 space-y-6">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <UserCheck className="w-5 h-5 text-primary" /> Face Verification
                                </h2>
                                <p className="text-white/40 text-xs mt-1">
                                    Confirm your identity before marking attendance. Centre your face in the frame and ensure good lighting.
                                </p>
                            </div>

                            {/* Camera feed */}
                            <div className="relative rounded-[28px] overflow-hidden aspect-video bg-black border border-white/10">
                                <Webcam
                                    ref={webcamRef}
                                    audio={false}
                                    screenshotFormat="image/jpeg"
                                    className="w-full h-full object-cover"
                                    videoConstraints={{ facingMode: 'user' }}
                                />
                                {/* Corner brackets */}
                                <div className="absolute top-4 left-4 w-10 h-10 border-t-2 border-l-2 border-primary/50 rounded-tl-xl pointer-events-none" />
                                <div className="absolute top-4 right-4 w-10 h-10 border-t-2 border-r-2 border-primary/50 rounded-tr-xl pointer-events-none" />
                                <div className="absolute bottom-4 left-4 w-10 h-10 border-b-2 border-l-2 border-primary/50 rounded-bl-xl pointer-events-none" />
                                <div className="absolute bottom-4 right-4 w-10 h-10 border-b-2 border-r-2 border-primary/50 rounded-br-xl pointer-events-none" />

                                {/* Face verified overlay */}
                                {faceVerified && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20">
                                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="bg-emerald-500/90 backdrop-blur-md p-6 rounded-full">
                                            <CheckCircle2 className="w-14 h-14 text-white" />
                                        </motion.div>
                                    </div>
                                )}
                            </div>

                            {/* Captured preview & result */}
                            {capturedFace && !faceVerified && (
                                <div className="p-4 rounded-2xl bg-white/3 border border-white/5 flex items-center gap-4">
                                    <img src={capturedFace} alt="Captured face" className="w-16 h-16 rounded-xl object-cover border border-white/10" />
                                    <div className="flex-1">
                                        <p className="text-sm font-bold">Face captured</p>
                                        <p className="text-xs text-white/30 mt-0.5">Click "Verify Face" to confirm your identity.</p>
                                    </div>
                                </div>
                            )}

                            {faceError && (
                                <div className="flex items-start gap-3 p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20">
                                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                                    <p className="text-sm text-rose-300">{faceError}</p>
                                </div>
                            )}

                            {faceVerified && (
                                <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                                    <p className="text-sm font-bold text-emerald-400">Identity confirmed — you may proceed!</p>
                                </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-3">
                                <button onClick={() => setStep('gps')} className="px-5 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-xs font-bold transition-all">Back</button>
                                {!faceVerified ? (
                                    <>
                                        <button
                                            onClick={captureFaceScan}
                                            disabled={faceVerifying}
                                            className="flex-1 py-4 bg-white/10 hover:bg-white/15 disabled:opacity-30 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                        >
                                            <Camera className="w-4 h-4" /> Capture
                                        </button>
                                        <button
                                            onClick={verifyFace}
                                            disabled={!capturedFace || faceVerifying}
                                            className="flex-1 py-4 bg-primary hover:bg-primary/80 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                        >
                                            {faceVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scan className="w-4 h-4" />}
                                            {faceVerifying ? 'Verifying…' : 'Verify Face'}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => setStep('photo')}
                                        className="flex-1 py-4 bg-emerald-500 hover:bg-emerald-400 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                    >
                                        <Camera className="w-4 h-4" /> Proceed to Classroom Photo
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* ── STEP 4: Live Classroom Photo ──────────────────────── */}
                    {step === 'photo' && (
                        <motion.div key="photo" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="glass-card p-8 rounded-[35px] border border-white/5 space-y-6">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Camera className="w-5 h-5 text-emerald-400" /> Classroom Evidence Photo
                                </h2>
                                <p className="text-white/40 text-xs mt-1">Take a photo of the classroom as evidence of your presence.</p>
                            </div>

                            {!capturedPhoto ? (
                                <div className="space-y-4">
                                    <div className="relative rounded-[28px] overflow-hidden aspect-video bg-black border border-white/10">
                                        <Webcam
                                            ref={webcamRef}
                                            audio={false}
                                            screenshotFormat="image/jpeg"
                                            className="w-full h-full object-cover"
                                            videoConstraints={{ facingMode: 'environment' }}
                                        />
                                    </div>
                                    <button
                                        onClick={capturePhoto}
                                        className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                    >
                                        <Camera className="w-4 h-4" /> Take Photo
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="relative rounded-[28px] overflow-hidden aspect-video bg-black border border-emerald-500/20">
                                        <img src={capturedPhoto} alt="Classroom" className="w-full h-full object-cover" />
                                        <div className="absolute top-4 right-4 bg-emerald-500/80 backdrop-blur rounded-full p-2">
                                            <CheckCircle2 className="w-5 h-5 text-white" />
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setCapturedPhoto(null)}
                                            className="px-5 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-xs font-bold transition-all flex items-center gap-2"
                                        >
                                            <RefreshCw className="w-4 h-4" /> Retake
                                        </button>
                                        <button
                                            onClick={submit}
                                            disabled={submitting}
                                            className="flex-1 py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                        >
                                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                                            {submitting ? 'Submitting…' : 'Submit Attendance'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!capturedPhoto && (
                                <button onClick={() => setStep('face')} className="text-xs text-white/30 hover:text-white/50 transition-colors">← Back to face scan</button>
                            )}
                        </motion.div>
                    )}

                    {/* ── STEP 5: Done ─────────────────────────────────────── */}
                    {step === 'done' && (
                        <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                            className="glass-card p-12 rounded-[40px] border border-emerald-500/20 bg-emerald-500/5 text-center space-y-6">
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                                className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/30">
                                <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                            </motion.div>

                            <div>
                                <h2 className="text-3xl font-black">Attendance Marked!</h2>
                                <p className="text-white/40 text-sm mt-2">Your GPS attendance has been recorded successfully.</p>
                            </div>

                            {result && (
                                <div className="grid grid-cols-2 gap-3 text-left">
                                    {result.distance !== undefined && (
                                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-white/30">Distance</p>
                                            <p className="text-lg font-bold mt-1 text-emerald-400">{result.distance} m</p>
                                        </div>
                                    )}
                                    {result.faceVerification && (
                                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-white/30">Face Match</p>
                                            <p className="text-lg font-bold mt-1 text-primary">
                                                {(result.faceVerification.confidence * 100).toFixed(0)}%
                                            </p>
                                        </div>
                                    )}
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-white/30">GPS Verified</p>
                                        <p className="text-sm font-bold mt-1">{result.locationVerified ? '✅ Yes' : '⚠️ No Classroom GPS Set'}</p>
                                    </div>
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-white/30">Time</p>
                                        <p className="text-sm font-bold mt-1">{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setStep('select'); setCapturedPhoto(null); setCapturedFace(null); setFaceVerified(false); setFaceError(null); setResult(null); }}
                                    className="flex-1 py-4 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                >
                                    <RefreshCw className="w-4 h-4" /> Mark Another
                                </button>
                                <button
                                    onClick={() => router.push('/teacher/dashboard')}
                                    className="flex-1 py-4 bg-emerald-500 hover:bg-emerald-400 rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
                                >
                                    Back to Dashboard
                                </button>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        </DashboardLayout>
    );
}
