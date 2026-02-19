'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Clock, Users, Plus, LayoutGrid, CheckCircle2,
  Search, Scan, AlertCircle, Mic, Camera,
  ShieldCheck, BadgeCheck, Fingerprint, ChevronRight,
  CalendarDays, Zap, UserCircle,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import ClassroomCard from '@/components/ClassroomCard';
import CreateClassroomModal from '@/components/modals/CreateClassroomModal';
import TeacherAttendanceModal from '@/components/modals/TeacherAttendanceModal';
import { useSession } from '@/providers/SessionProvider';

type AttendanceView = 'register_face' | 'scan_face' | 'voice_face' | null;

/* ── Attendance action cards config (dashboard shows only scan methods) ── */
const ATTENDANCE_ACTIONS = [
  {
    id: 'scan_face' as AttendanceView,
    icon: Scan,
    label: 'Scan Face',
    subtitle: 'Quick & secure face check-in',
    gradient: 'from-blue-600 to-cyan-500',
    glow: 'shadow-blue-500/30',
    border: 'border-blue-500/20',
    bg: 'bg-blue-500/10',
    iconColor: 'text-blue-400',
    hoverBg: 'hover:bg-blue-500/15',
    pill: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
    pillText: 'Fast',
  },
  {
    id: 'voice_face' as AttendanceView,
    icon: Mic,
    label: 'Voice & Face',
    subtitle: 'Dual biometric verification',
    gradient: 'from-purple-600 to-pink-600',
    glow: 'shadow-purple-500/30',
    border: 'border-purple-500/20',
    bg: 'bg-purple-500/10',
    iconColor: 'text-purple-400',
    hoverBg: 'hover:bg-purple-500/15',
    pill: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
    pillText: 'Secure',
  },
];

export default function TeacherDashboard() {
  const { activeSessions, refreshSessions } = useSession();
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [attendanceInitialView, setAttendanceInitialView] = useState<AttendanceView>(null);
  const [userData, setUserData] = useState<any>(null);
  const [attendanceMarked, setAttendanceMarked] = useState<boolean | null>(null);
  const [attendanceMarkedAt, setAttendanceMarkedAt] = useState<string | null>(null);
  const [liveTime, setLiveTime] = useState('');
  const [liveDate, setLiveDate] = useState('');

  /* ── Live clock ── */
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setLiveTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setLiveDate(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const checkAttendanceStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/teacher-attendance/status');
      if (res.success) {
        setAttendanceMarked(res.data.marked);
        setAttendanceMarkedAt(res.data.record?.markedAt || null);
      }
    } catch {
      // Non-critical
    }
  }, []);

  const loadData = async () => {
    try {
      const [sectionsRes, userRes] = await Promise.all([
        fetchWithAuth('/sections/teacher'),
        fetchWithAuth('/auth/me')
      ]);
      setSections(sectionsRes.data?.sections || []);
      setUserData(userRes.data?.user);
      refreshSessions();
    } catch (err) {
      console.error(err);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    checkAttendanceStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalStudents = sections.reduce((acc, curr) => acc + (curr.students?.length || 0), 0);

  const stats = [
    { label: 'Total Students', value: totalStudents.toString(), icon: <Users className="text-primary" />, trend: 'Enrolled' },
    { label: 'My Classrooms', value: sections.length.toString(), icon: <LayoutGrid className="text-secondary" />, trend: 'Active' },
    { label: 'Live Sessions', value: activeSessions.length.toString(), icon: <Clock className="text-accent" />, trend: 'Active Now' },
    { label: 'Avg Attendance', value: '0%', icon: <Activity className="text-emerald-500" />, trend: 'N/A' },
  ];

  const getAttendanceTime = () => {
    if (!attendanceMarkedAt) return '';
    return new Date(attendanceMarkedAt).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  };

  const openModal = (view: AttendanceView = null) => {
    setAttendanceInitialView(view);
    setIsAttendanceModalOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-10">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-gradient">Teacher Dashboard</h1>
            <p className="text-white/40 text-sm font-medium">Command center for your academic sessions and biometric logs.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Create Classroom */}
            <button
              onClick={() => setIsModalOpen(true)}
              className="group flex items-center space-x-3 bg-primary hover:bg-primary-glow text-white px-8 py-4 rounded-[28px] transition-all shadow-xl shadow-primary/20"
            >
              <div className="p-1 bg-white/20 rounded-lg group-hover:rotate-90 transition-all">
                <Plus className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest">Create Classroom</span>
            </button>
          </div>
        </div>

        {/* ── Stats Grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass-card p-6 rounded-[35px] border-white/5 space-y-4 hover:border-primary/20 transition-all"
            >
              <div className="flex justify-between items-start">
                <div className="p-3 bg-white/5 rounded-2xl border border-white/5">{stat.icon}</div>
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{stat.trend}</span>
              </div>
              <div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">{stat.label}</p>
                <h4 className="text-3xl font-black tracking-tighter">{stat.value}</h4>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  TEACHER ATTENDANCE MANAGEMENT CARD                              */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 280, damping: 26 }}
          className="relative overflow-hidden rounded-[40px] border border-white/8 glass-card"
        >
          {/* Background glow blobs */}
          <div className="absolute top-0 left-1/4 w-80 h-32 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 right-1/4 w-64 h-24 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative p-8 md:p-10 space-y-8">

            {/* ── Card Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div className="flex items-center gap-4">
                {/* Shield icon bubble */}
                <div className="shrink-0 w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shadow-lg shadow-indigo-500/10">
                  <ShieldCheck className="w-7 h-7 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
                    Teacher Attendance Management
                  </h2>
                  <p className="text-white/40 text-xs font-medium mt-0.5">Select a method to mark or register your attendance</p>
                </div>
              </div>

              {/* Right side: status badge + live time */}
              <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                {/* Attendance status badge */}
                <AnimatePresence mode="wait">
                  {attendanceMarked === null ? (
                    <motion.div key="loading-badge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                      <div className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white/50 animate-spin" />
                      <span className="text-xs text-white/30 font-medium">Checking status…</span>
                    </motion.div>
                  ) : attendanceMarked ? (
                    <motion.div key="marked-badge"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/15 border border-emerald-500/30">
                      <BadgeCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-emerald-300">Present · {getAttendanceTime()}</span>
                    </motion.div>
                  ) : (
                    <motion.button key="not-marked-badge"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      onClick={() => openModal()}
                      className="group flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15 transition-all">
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-amber-300">Not Marked · Mark Now</span>
                      <ChevronRight className="w-3.5 h-3.5 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                    </motion.button>
                  )}
                </AnimatePresence>

                {/* Live time pill */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/4 border border-white/8 text-[11px] text-white/35 font-mono">
                  <Clock className="w-3 h-3" />
                  {liveTime}
                </div>
              </div>
            </div>

            {/* ── Date strip ── */}
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/3 border border-white/6 w-fit">
              <CalendarDays className="w-4 h-4 text-white/30" />
              <span className="text-xs text-white/40 font-medium">{liveDate}</span>
            </div>

            {/* ── Action Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {ATTENDANCE_ACTIONS.map((action, i) => {
                const Icon = action.icon;
                return (
                  <motion.button
                    key={action.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 + i * 0.08, type: 'spring', stiffness: 260, damping: 24 }}
                    whileHover={{ scale: 1.03, y: -3 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => openModal(action.id)}
                    className={`group relative flex flex-col items-start gap-5 p-6 rounded-[28px] border ${action.border} ${action.bg} ${action.hoverBg} hover:border-white/20 transition-all duration-300 shadow-lg ${action.glow} hover:shadow-xl text-left overflow-hidden`}
                  >
                    {/* Gradient shimmer on hover */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${action.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300 rounded-[28px]`} />

                    {/* Top row: icon + pill */}
                    <div className="relative flex items-start justify-between w-full">
                      <div className={`w-14 h-14 rounded-2xl ${action.bg} border ${action.border} flex items-center justify-center shadow-md`}>
                        <Icon className={`w-7 h-7 ${action.iconColor}`} />
                      </div>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${action.pill}`}>
                        {action.pillText}
                      </span>
                    </div>

                    {/* Text */}
                    <div className="relative space-y-1">
                      <p className={`text-base font-black ${action.iconColor}`}>{action.label}</p>
                      <p className="text-xs text-white/40 leading-relaxed">{action.subtitle}</p>
                    </div>

                    {/* Arrow indicator */}
                    <div className={`relative flex items-center gap-1.5 text-xs font-bold ${action.iconColor} group-hover:gap-2.5 transition-all`}>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Get Started</span>
                      <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* ── Bottom info strip ── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-white/5">
              <Link
                href="/teacher/profile"
                className="flex items-center gap-2 text-xs text-white/30 hover:text-indigo-400 transition-colors group"
              >
                <UserCircle className="w-3.5 h-3.5 group-hover:text-indigo-400 transition-colors" />
                <span>Register biometrics → <span className="text-indigo-400/60 group-hover:text-indigo-400 transition-colors">Profile &amp; Settings</span></span>
              </Link>
              {attendanceMarked === false && (
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => openModal('scan_face')}
                  className="flex items-center gap-2 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors px-4 py-2 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/15 border border-indigo-500/20"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Quick Scan →
                </motion.button>
              )}
            </div>

          </div>
        </motion.div>

        {/* ── Attendance Reminder Banner (when not marked) ── */}
        {attendanceMarked === false && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between p-5 rounded-[24px] bg-amber-500/8 border border-amber-500/20"
          >
            <div className="flex items-center space-x-4">
              <div className="p-2.5 rounded-xl bg-amber-500/15">
                <Scan className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-300">Your attendance is not marked yet</p>
                <p className="text-xs text-white/40">Use Face Scan or Voice &amp; Face verification above to mark yourself present</p>
              </div>
            </div>
            <button
              onClick={() => openModal('scan_face')}
              className="text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20"
            >
              Scan Now →
            </button>
          </motion.div>
        )}

        {/* ── Classrooms Section ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h3 className="text-2xl font-black tracking-tight">Active Classrooms</h3>
              <span className="px-3 py-1 bg-white/5 rounded-full border border-white/5 text-[10px] font-bold text-white/40">
                {sections.length}
              </span>
            </div>
            <div className="hidden md:flex items-center space-x-3 bg-white/5 px-6 py-3 rounded-2xl border border-white/5">
              <Search className="w-4 h-4 text-white/20" />
              <input type="text" placeholder="Search classes..." className="bg-transparent border-none text-xs focus:outline-none placeholder:text-white/10" />
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {[1, 2, 3].map(i => <div key={i} className="h-[280px] bg-white/5 animate-pulse rounded-[35px]" />)}
            </div>
          ) : sections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {sections.map((section) => {
                const isOngoing = activeSessions.some(s => s.sectionId?._id === section._id || s.sectionId === section._id);
                return (
                  <ClassroomCard
                    key={section._id}
                    section={section}
                    role="TEACHER"
                    isOngoing={isOngoing}
                    onRefresh={loadData}
                  />
                );
              })}
            </div>
          ) : (
            <div className="glass-card p-16 rounded-[50px] text-center border-2 border-dashed border-white/5 space-y-6">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <LayoutGrid className="w-10 h-10 text-primary/40" />
              </div>
              <div className="space-y-2">
                <h4 className="text-xl font-bold">No classrooms found</h4>
                <p className="text-sm text-white/30 max-w-sm mx-auto">Create a classroom to share the code with students and start tracking attendance.</p>
              </div>
              <button onClick={() => setIsModalOpen(true)} className="btn-primary">
                Create My First Class
              </button>
            </div>
          )}
        </div>

        {/* ── System Health ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6">
          <div className="glass-card p-10 rounded-[45px] space-y-6">
            <h3 className="text-xl font-bold tracking-tight">Infrastructure Health</h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="p-8 rounded-[35px] bg-emerald-500/5 border border-emerald-500/10 flex flex-col items-center justify-center space-y-3 text-center">
                <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin"></div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Master Node</p>
                <p className="text-xl font-black text-emerald-500">STABLE</p>
              </div>
              <div className="p-8 rounded-[35px] bg-white/5 border border-white/5 flex flex-col items-center justify-center space-y-3 text-center">
                <CheckCircle2 className="w-12 h-12 text-primary" />
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Biometric Hub</p>
                <p className="text-xl font-black">ACTIVE</p>
              </div>
            </div>
          </div>

          <div className="glass-card p-10 rounded-[45px] flex flex-col justify-center items-center text-center space-y-6 bg-gradient-to-br from-primary/10 via-transparent to-transparent border-primary/10">
            <Activity className="w-16 h-16 text-primary/40" />
            <div className="space-y-2">
              <h3 className="text-xl font-black italic text-white/60 tracking-tight">&quot;Engine optimized for high-density environments.&quot;</h3>
              <p className="text-[8px] font-black text-primary uppercase tracking-[0.3em] pt-4">SYSTEM CORE V1.0.4</p>
            </div>
          </div>
        </div>

      </div>

      <CreateClassroomModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={loadData}
      />

      <TeacherAttendanceModal
        isOpen={isAttendanceModalOpen}
        onClose={() => {
          setIsAttendanceModalOpen(false);
          setAttendanceInitialView(null);
        }}
        onSuccess={() => {
          setAttendanceMarked(true);
          setAttendanceMarkedAt(new Date().toISOString());
        }}
        initialView={attendanceInitialView}
      />
    </DashboardLayout>
  );
}
