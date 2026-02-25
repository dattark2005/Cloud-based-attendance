'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Clock, CheckCircle2, AlertCircle, Play, Activity, RefreshCw,
  BookOpen, ChevronRight, Mic, MicOff, Camera, Eye, X, StopCircle,
  BarChart2, Calendar, Hash, Volume2
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import Webcam from 'react-webcam';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Section {
  _id: string;
  sectionName: string;
  joinCode: string;
  courseId: { courseName: string; courseCode: string } | null;
}

interface Lecture {
  _id: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  topic?: string;
  attendanceCount: number;
}

interface AttendanceStats {
  totalStudents: number;
  present: number;
  late: number;
  absent: number;
  marked: number;
  attendanceRate: string;
}

interface AttendanceRecord {
  _id: string;
  studentId: { fullName: string; studentId: string };
  status: string;
  markedAt: string;
  confidenceScore: number;
  verificationMethod: string;
  faceImageUrl?: string;
}

// ─── Status colour helper ─────────────────────────────────────────────────────

function statusColor(s: string) {
  if (s === 'ONGOING') return 'text-emerald-400 bg-emerald-400/10';
  if (s === 'COMPLETED') return 'text-white/30 bg-white/5';
  return 'text-amber-400 bg-amber-400/10';
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TeacherAttendance() {
  // Section & lecture selection
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [selectedLecture, setSelectedLecture] = useState<Lecture | null>(null);
  const [loadingLectures, setLoadingLectures] = useState(false);

  // Attendance state
  const [attendanceData, setAttendanceData] = useState<{ stats: AttendanceStats; attendanceRecords: AttendanceRecord[]; absentStudents: any[] } | null>(null);
  const [isRequestActive, setIsRequestActive] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Biometric mode
  const [biometricMode, setBiometricMode] = useState<'FACE' | 'VOICE'>('FACE');

  // Camera (face preview for teacher to confirm stream is live)
  const webcamRef = useRef<Webcam>(null);
  const [showCamera, setShowCamera] = useState(false);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSentence, setVoiceSentence] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ── 1. Load teacher's sections ───────────────────────────────────────────
  useEffect(() => {
    const loadSections = async () => {
      try {
        const res = await fetchWithAuth('/sections/teacher');
        setSections(res.data?.sections || []);
      } catch (err: any) {
        toast.error('Failed to load your classrooms');
      }
    };
    loadSections();
  }, []);

  // ── 2. Load lectures when section selected ────────────────────────────────
  useEffect(() => {
    if (!selectedSection) { setLectures([]); setSelectedLecture(null); return; }
    const loadLectures = async () => {
      setLoadingLectures(true);
      setSelectedLecture(null);
      setAttendanceData(null);
      try {
        const res = await fetchWithAuth(`/sections/${selectedSection._id}/lectures`);
        setLectures(res.data?.lectures || []);
        if (res.data?.lectures?.length === 0) {
          toast('No sessions yet for this classroom. Start a session first from the Session tab.', { icon: 'ℹ️' });
        }
      } catch {
        toast.error('Failed to load lectures');
      } finally {
        setLoadingLectures(false);
      }
    };
    loadLectures();
  }, [selectedSection]);

  // ── 3. Load attendance status when lecture selected ───────────────────────
  const loadAttendanceStatus = useCallback(async (lectureId: string) => {
    try {
      const res = await fetchWithAuth(`/attendance/status/${lectureId}`);
      if (res.success) {
        setAttendanceData(res.data);
        setIsRequestActive(res.data.attendanceRequest?.status === 'ACTIVE' && !res.data.attendanceRequest?.isExpired);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!selectedLecture) return;
    loadAttendanceStatus(selectedLecture._id);
  }, [selectedLecture, loadAttendanceStatus]);

  // ── 4. Start attendance request (opens window for students) ──────────────
  const triggerAttendance = async () => {
    if (!selectedLecture) return;
    setIsRequesting(true);
    try {
      await fetchWithAuth('/attendance/request', {
        method: 'POST',
        body: JSON.stringify({ lectureId: selectedLecture._id, durationMinutes: 10 }),
      });
      toast.success('✅ Attendance window opened for 10 minutes!');
      setIsRequestActive(true);
      startPolling(selectedLecture._id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to open attendance window');
    } finally {
      setIsRequesting(false);
    }
  };

  const startPolling = (lectureId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => loadAttendanceStatus(lectureId), 4000);
  };

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  // ── 5. Voice verification sentence ───────────────────────────────────────
  const fetchVoiceSentence = async () => {
    try {
      const res = await fetchWithAuth('/biometric/voice/sentence');
      setVoiceSentence(res.data?.sentence || 'My name is present today');
    } catch {
      setVoiceSentence('My name is present today');
    }
  };

  useEffect(() => { if (biometricMode === 'VOICE') fetchVoiceSentence(); }, [biometricMode]);

  // ── 6. Teacher voice recording (to manually mark self or demo) ────────────
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await submitVoiceForVerification(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      // Auto-stop after 5 seconds
      setTimeout(() => stopVoiceRecording(), 5000);
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const submitVoiceForVerification = async (blob: Blob) => {
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const res = await fetchWithAuth('/biometric/voice/verify', {
          method: 'POST',
          body: JSON.stringify({ voiceAudio: base64, expectedText: voiceSentence }),
        });
        if (res.data?.verified) {
          toast.success(`✅ Voice verified! Confidence: ${(res.data.confidence * 100).toFixed(0)}%`);
        } else {
          toast.error('❌ Voice did not match. Try again.');
        }
      };
      reader.readAsDataURL(blob);
    } catch (err: any) {
      toast.error(err.message || 'Voice verification failed');
    }
  };

  // ── 7. Capture face snapshot for verification ─────────────────────────────
  const captureFaceAndVerify = async () => {
    if (!webcamRef.current) return;
    const screenshot = webcamRef.current.getScreenshot();
    if (!screenshot) { toast.error('Could not capture image'); return; }
    try {
      const res = await fetchWithAuth('/biometric/face/verify', {
        method: 'POST',
        body: JSON.stringify({ faceImage: screenshot }),
      });
      if (res.data?.verified) {
        toast.success(`✅ Face verified! Confidence: ${(res.data.confidence * 100).toFixed(0)}%`);
      } else {
        toast.error('❌ Face did not match enrolled profile');
      }
    } catch (err: any) {
      toast.error(err.message || 'Face verification failed');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-black tracking-tight">Attendance Control</h1>
          <p className="text-white/40 text-sm mt-1">Select a classroom → pick a lecture → open biometric window</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* ── LEFT PANEL: Selection ────────────────────────────────────────── */}
          <div className="xl:col-span-1 space-y-6">

            {/* Section Picker */}
            <div className="glass-card p-6 rounded-3xl border border-white/5 space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-white/40 flex items-center gap-2">
                <BookOpen className="w-4 h-4" /> Your Classrooms
              </h3>
              {sections.length === 0 ? (
                <p className="text-xs text-white/20 text-center py-4">No classrooms yet. Create one first.</p>
              ) : (
                sections.map(sec => (
                  <button
                    key={sec._id}
                    onClick={() => setSelectedSection(sec)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all ${selectedSection?._id === sec._id
                        ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                        : 'border-white/5 bg-white/3 hover:border-white/10'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-primary/70">{sec.courseId?.courseCode ?? '—'}</p>
                        <p className="font-bold text-sm">{sec.courseId?.courseName ?? sec.sectionName}</p>
                        <p className="text-[10px] text-white/30 mt-0.5">Code: {sec.joinCode}</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 transition-transform ${selectedSection?._id === sec._id ? 'rotate-90 text-primary' : 'text-white/20'}`} />
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Lecture Picker */}
            {selectedSection && (
              <div className="glass-card p-6 rounded-3xl border border-white/5 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/40 flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Sessions
                </h3>
                {loadingLectures ? (
                  <div className="flex justify-center py-4">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : lectures.length === 0 ? (
                  <p className="text-xs text-white/20 text-center py-4">No sessions for this classroom yet.</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {lectures.map(lec => (
                      <button
                        key={lec._id}
                        onClick={() => setSelectedLecture(lec)}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${selectedLecture?._id === lec._id
                            ? 'border-primary bg-primary/10'
                            : 'border-white/5 bg-white/3 hover:border-white/10'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold truncate">{lec.topic || 'Untitled Session'}</p>
                            <p className="text-[10px] text-white/30 mt-0.5">
                              {new Date(lec.scheduledStart).toLocaleString('en-IN', {
                                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${statusColor(lec.status)}`}>{lec.status}</span>
                            <span className="text-[9px] text-white/30">{lec.attendanceCount} present</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Biometric Mode Toggle */}
            {selectedLecture && (
              <div className="glass-card p-4 rounded-3xl border border-white/5">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-3">Verification Mode</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBiometricMode('FACE')}
                    className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${biometricMode === 'FACE' ? 'bg-primary text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'
                      }`}
                  >
                    <Camera className="w-4 h-4" /> Face
                  </button>
                  <button
                    onClick={() => setBiometricMode('VOICE')}
                    className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${biometricMode === 'VOICE' ? 'bg-violet-500 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'
                      }`}
                  >
                    <Mic className="w-4 h-4" /> Voice
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT PANEL: Action + Stats ──────────────────────────────────── */}
          <div className="xl:col-span-2 space-y-6">
            {!selectedLecture ? (
              <div className="h-96 flex flex-col items-center justify-center glass-card rounded-[40px] border border-white/5 opacity-40 space-y-4">
                <AlertCircle className="w-14 h-14 text-white/20" />
                <div className="text-center">
                  <h2 className="text-xl font-bold">Select a Lecture</h2>
                  <p className="text-sm text-white/30 mt-1">Choose a classroom and a session from the left panel</p>
                </div>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedLecture._id}
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  {/* Session Banner */}
                  <div className="glass-card p-8 rounded-[40px] border border-primary/20 space-y-6">
                    <div className="flex flex-col sm:flex-row justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${statusColor(selectedLecture.status)}`}>
                            {selectedLecture.status}
                          </span>
                          <span className="text-[10px] text-white/30 font-mono">{selectedLecture._id.slice(-8)}</span>
                        </div>
                        <h2 className="text-2xl font-bold">
                          {selectedLecture.topic || 'Session'}: {selectedSection?.courseId?.courseName}
                        </h2>
                        <p className="text-white/40 text-sm mt-1 flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {new Date(selectedLecture.scheduledStart).toLocaleString('en-IN', {
                            weekday: 'long', day: '2-digit', month: 'long',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </p>
                      </div>

                      {/* Open Attendance Window Button */}
                      <button
                        onClick={triggerAttendance}
                        disabled={isRequesting || isRequestActive}
                        className={`self-start sm:self-center flex items-center gap-2 px-7 py-4 rounded-[24px] font-black text-xs uppercase tracking-widest transition-all ${isRequestActive
                            ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 cursor-not-allowed'
                            : 'bg-primary hover:bg-primary/80 text-white'
                          }`}
                      >
                        {isRequesting ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : isRequestActive ? (
                          <><Activity className="w-4 h-4 animate-pulse" /> Window Open</>
                        ) : (
                          <><Play className="w-4 h-4 fill-white" /> Open Attendance Window</>
                        )}
                      </button>
                    </div>

                    {/* Stats Row */}
                    {attendanceData && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[
                          { label: 'Present', value: attendanceData.stats.present, color: 'text-emerald-400' },
                          { label: 'Late', value: attendanceData.stats.late, color: 'text-amber-400' },
                          { label: 'Absent', value: attendanceData.stats.absent, color: 'text-rose-400' },
                          { label: 'Rate', value: `${attendanceData.stats.attendanceRate}%`, color: 'text-primary' },
                        ].map(stat => (
                          <div key={stat.label} className="bg-white/5 rounded-2xl p-4 space-y-1 border border-white/5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/30">{stat.label}</p>
                            <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── BIOMETRIC PANEL ───────────────────────────────────────── */}
                  {biometricMode === 'FACE' ? (
                    <div className="glass-card p-6 rounded-[35px] border border-white/5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-bold flex items-center gap-2">
                            <Camera className="w-4 h-4 text-primary" /> Face Verification Preview
                          </h3>
                          <p className="text-[10px] text-white/30 mt-0.5">For testing your own face auth. Students verify themselves in the session page.</p>
                        </div>
                        <button
                          onClick={() => setShowCamera(v => !v)}
                          className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold tracking-widest transition-all flex items-center gap-2"
                        >
                          {showCamera ? <><X className="w-3 h-3" /> Close</> : <><Eye className="w-3 h-3" /> Open Camera</>}
                        </button>
                      </div>

                      {showCamera && (
                        <div className="space-y-4">
                          <div className="relative rounded-3xl overflow-hidden aspect-video bg-black border border-white/5">
                            <Webcam
                              ref={webcamRef}
                              audio={false}
                              screenshotFormat="image/jpeg"
                              className="w-full h-full object-cover"
                              videoConstraints={{ facingMode: 'user' }}
                            />
                            {/* Corner brackets */}
                            <div className="absolute top-4 left-4 w-10 h-10 border-t-2 border-l-2 border-primary/40 rounded-tl-xl" />
                            <div className="absolute top-4 right-4 w-10 h-10 border-t-2 border-r-2 border-primary/40 rounded-tr-xl" />
                            <div className="absolute bottom-4 left-4 w-10 h-10 border-b-2 border-l-2 border-primary/40 rounded-bl-xl" />
                            <div className="absolute bottom-4 right-4 w-10 h-10 border-b-2 border-r-2 border-primary/40 rounded-br-xl" />
                          </div>
                          <button
                            onClick={captureFaceAndVerify}
                            className="w-full py-4 bg-primary hover:bg-primary/80 rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
                          >
                            Capture & Verify Face
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* VOICE PANEL */
                    <div className="glass-card p-6 rounded-[35px] border border-violet-500/20 space-y-5">
                      <div>
                        <h3 className="font-bold flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-violet-400" /> Voice Verification
                        </h3>
                        <p className="text-[10px] text-white/30 mt-0.5">Record yourself saying the phrase below to verify your voice print.</p>
                      </div>

                      {/* Phrase card */}
                      <div className="p-4 rounded-2xl bg-violet-500/10 border border-violet-500/20">
                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-400/60 mb-1">Say this phrase:</p>
                        <p className="text-lg font-bold text-violet-200 leading-snug">"{voiceSentence}"</p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                          className={`flex-1 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${isRecording
                              ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
                              : 'bg-violet-500 hover:bg-violet-600 text-white'
                            }`}
                        >
                          {isRecording
                            ? <><StopCircle className="w-4 h-4" /> Stop & Verify (auto-stops in 5s)</>
                            : <><Mic className="w-4 h-4" /> Start Recording</>}
                        </button>
                        <button
                          onClick={fetchVoiceSentence}
                          className="px-4 py-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-all"
                          title="Get new phrase"
                        >
                          <RefreshCw className="w-4 h-4 text-white/40" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── LIVE ATTENDANCE FEED ──────────────────────────────────── */}
                  {attendanceData && attendanceData.attendanceRecords.length > 0 && (
                    <div className="glass-card p-6 rounded-[35px] border border-white/5 space-y-4">
                      <h3 className="font-bold flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Verified Students
                        <span className="ml-auto text-xs font-normal text-white/30">
                          {attendanceData.attendanceRecords.length} / {attendanceData.stats.totalStudents}
                        </span>
                      </h3>
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {attendanceData.attendanceRecords.map(rec => (
                          <div key={rec._id} className="flex items-center gap-3 p-3 bg-white/3 rounded-2xl border border-white/5">
                            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center shrink-0">
                              {rec.faceImageUrl
                                ? <img src={rec.faceImageUrl} alt={rec.studentId.fullName} className="w-full h-full object-cover" />
                                : <Users className="w-5 h-5 text-white/20" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{rec.studentId.fullName}</p>
                              <p className="text-[10px] text-white/30 font-mono">{new Date(rec.markedAt).toLocaleTimeString('en-IN')}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className={`text-xs font-black ${rec.status === 'PRESENT' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {rec.status}
                              </p>
                              <p className="text-[10px] text-white/30">{rec.verificationMethod}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Absent students */}
                  {attendanceData && attendanceData.absentStudents.length > 0 && (
                    <div className="glass-card p-6 rounded-[35px] border border-rose-500/10 space-y-3">
                      <h3 className="font-bold flex items-center gap-2 text-rose-400">
                        <AlertCircle className="w-4 h-4" /> Not Yet Marked ({attendanceData.absentStudents.length})
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {attendanceData.absentStudents.map((s: any) => (
                          <span key={s._id} className="text-[11px] px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300">
                            {s.fullName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
