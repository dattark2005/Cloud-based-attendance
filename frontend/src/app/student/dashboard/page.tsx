'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Clock,
  Calendar,
  CheckCircle2,
  XCircle,
  TrendingUp,
  MapPin,
  ArrowRight,
  Activity,
  Camera,
  Plus,
  LayoutGrid,
  Lock
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import ClassroomCard from '@/components/ClassroomCard';
import JoinClassroomModal from '@/components/modals/JoinClassroomModal';
import { useSession } from '@/providers/SessionProvider';

export default function StudentDashboard() {
  const { activeSessions, refreshSessions } = useSession();
  const [stats, setStats] = useState<any>(null);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  const [userData, setUserData] = useState<any>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [showSuccess, setShowSuccess] = useState(false);

  // Password change state
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  useEffect(() => {
    if (searchParams.get('enrolled') === 'true') {
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
        // Clean up URL
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  const loadData = async () => {
    try {
      const [historyRes, userRes, sectionsRes] = await Promise.all([
        fetchWithAuth('/attendance/history'),
        fetchWithAuth('/auth/me'),
        fetchWithAuth('/sections/student')
      ]);

      setUserData(userRes.data?.user);
      setSections(sectionsRes.data?.sections || []);
      const records = historyRes.data?.records || [];
      setRecentLogs(records);
      refreshSessions();

      const stats = historyRes.data?.stats;
      setStats({
        attendancePercentage: (stats?.attendanceRate || 0) + '%',
        totalMinutes: stats?.total || 0,
        lastSession: records[0]?.lectureId?.sectionId?.courseId?.courseName || 'None',
        status: activeSessions.length > 0 ? 'ACTIVE' : 'IN'
      });
    } catch (err) {
      console.error(err);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd || !confirmPwd) { toast.error('All password fields are required'); return; }
    if (newPwd !== confirmPwd) { toast.error('New passwords do not match'); return; }
    if (newPwd.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setChangingPwd(true);
    try {
      const res = await fetchWithAuth('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      if (res.success) {
        toast.success('🎉 Password changed successfully!');
        setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
        setShowPwdForm(false);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPwd(false);
    }
  };

  const statCards = [
    { label: 'Attendance Rate', value: stats?.attendancePercentage || '--', icon: <TrendingUp className="text-primary" />, trend: '+2.4%' },
    { label: 'Time in Campus', value: stats?.totalMinutes || '--', icon: <Clock className="text-secondary" />, trend: 'mins' },
    { label: 'Current Status', value: stats?.status || '--', icon: <Activity className="text-emerald-500" />, trend: 'Live' },
    { label: 'Live Classes', value: activeSessions.length.toString(), icon: <Calendar className="text-accent" />, trend: 'Sync' },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-10">
        {/* Face Enrollment Status Banner */}
        {!loading && userData && !userData.faceRegistered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-1 px-1 rounded-[30px] bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 border border-white/10"
          >
            <div className="glass-card p-6 py-4 rounded-[28px] border-none flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center">
                  <Camera className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">Biometric Profile Incomplete</h4>
                  <p className="text-[10px] text-white/50 uppercase tracking-widest leading-none mt-1">Enroll your face to enable AI attendance marking</p>
                </div>
              </div>
              <button
                onClick={() => window.location.href = '/register?only=face'}
                className="px-6 py-3 bg-primary text-white text-[10px] font-bold rounded-2xl hover:bg-primary-glow transition-all uppercase tracking-widest shrink-0"
              >
                Complete Enrollment Now
              </button>
            </div>
          </motion.div>
        )}

        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-gradient">Student Dashboard</h1>
            <p className="text-white/40 text-sm font-medium">Synced with your active classrooms and biometric data.</p>
          </div>
          <button
            onClick={() => setIsJoinModalOpen(true)}
            className="flex items-center space-x-3 bg-white/5 hover:bg-white/10 text-white px-8 py-4 rounded-[28px] border border-white/10 transition-all shadow-xl"
          >
            <Plus className="w-5 h-5 text-primary" />
            <span className="text-xs font-bold uppercase tracking-widest">Join New Class</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass-card p-6 rounded-[35px] border-white/5 space-y-4 hover:border-primary/20 transition-all"
            >
              <div className="flex justify-between items-start">
                <div className="p-3 bg-white/5 rounded-2xl border border-white/5">
                  {stat.icon}
                </div>
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{stat.trend}</span>
              </div>
              <div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">{stat.label}</p>
                <h4 className="text-3xl font-black tracking-tighter">{stat.value}</h4>
              </div>
            </motion.div>
          ))}
        </div>

        {/* My Classrooms Section */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-black tracking-tight">Enrolled Classrooms</h3>
            <span className="text-xs font-bold text-primary px-4 py-2 bg-primary/10 rounded-full border border-primary/20">
              {sections.length} Active
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[1, 2, 3].map(i => <div key={i} className="h-[250px] bg-white/5 animate-pulse rounded-[35px]" />)}
            </div>
          ) : sections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {sections.map(section => {
                const isOngoing = activeSessions.some(s => s.sectionId?._id === section._id || s.sectionId === section._id);
                return (
                  <ClassroomCard
                    key={section._id}
                    section={section}
                    role="STUDENT"
                    isOngoing={isOngoing}
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
                <p className="text-sm text-white/30 max-w-sm mx-auto">Use the class code provided by your teacher to sync your profile with a specific classroom session.</p>
              </div>
              <button
                onClick={() => setIsJoinModalOpen(true)}
                className="btn-primary"
              >
                Join Your First Class
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Activity Logs */}
          <div className="lg:col-span-2 glass-card p-10 rounded-[45px] space-y-8 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black tracking-tight">Attendance Timeline</h3>
              <button className="text-xs font-bold text-primary hover:underline uppercase tracking-widest">Full History</button>
            </div>

            <div className="space-y-6">
              {loading ? (
                [1, 2, 3].map(i => <div key={i} className="h-20 bg-white/5 animate-pulse rounded-[30px]" />)
              ) : recentLogs.length > 0 ? (
                recentLogs.map((log, i) => (
                  <div key={i} className="flex items-center justify-between p-6 rounded-[35px] bg-white/5 border border-white/5 hover:bg-white/10 transition-all group">
                    <div className="flex items-center space-x-5">
                      <div className={`p-4 rounded-2xl ${log.type === 'ENTRY' ? 'bg-emerald-500/10' : 'bg-primary/10'}`}>
                        <MapPin className={`w-6 h-6 ${log.type === 'ENTRY' ? 'text-emerald-500' : 'text-primary'}`} />
                      </div>
                      <div>
                        <h5 className="font-bold text-base tracking-tight">
                          {log.lectureId?.sectionId?.courseId?.courseName || 'General Entry'}
                        </h5>
                        <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest mt-1">
                          {new Date(log.markedAt).toDateString()} • {new Date(log.markedAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-black px-4 py-2 rounded-full border ${log.status === 'PRESENT' ? 'border-emerald-500/20 text-emerald-500 bg-emerald-500/5' : 'border-primary/20 text-primary bg-primary/5'}`}>
                        {log.status}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto">
                    <Activity className="w-8 h-8 text-white/20" />
                  </div>
                  <p className="text-white/30 text-sm italic">No recent biometric activity found.</p>
                </div>
              )}
            </div>
          </div>

          {/* Identity/Security Panel */}
          <div className="space-y-8">
            <div className="glass-card p-8 rounded-[45px] bg-gradient-to-br from-primary/10 via-transparent to-transparent border-primary/10 space-y-6">
              <h3 className="text-xl font-bold tracking-tight">Security & Privacy</h3>
              <div className="space-y-4">
                <div className="flex items-start space-x-4">
                  <div className="p-3 bg-white/5 rounded-2xl border border-white/5 mt-1 shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed font-medium">Your biometric data is processed on edge nodes and never leaves our secure cloud perimeter as raw images.</p>
                </div>
              </div>

              {/* Change Password */}
              <div className="pt-2 border-t border-white/8 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-white/60">Change Password</p>
                  <button
                    onClick={() => setShowPwdForm(v => !v)}
                    className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-all"
                  >
                    {showPwdForm ? 'Cancel' : 'Update'}
                  </button>
                </div>
                {showPwdForm && (
                  <div className="space-y-3">
                    <input
                      type="password"
                      value={currentPwd}
                      onChange={e => setCurrentPwd(e.target.value)}
                      placeholder="Current password"
                      className="input-field text-sm w-full"
                    />
                    <input
                      type="password"
                      value={newPwd}
                      onChange={e => setNewPwd(e.target.value)}
                      placeholder="New password (min 6 chars)"
                      className="input-field text-sm w-full"
                    />
                    <input
                      type="password"
                      value={confirmPwd}
                      onChange={e => setConfirmPwd(e.target.value)}
                      placeholder="Confirm new password"
                      className="input-field text-sm w-full"
                    />
                    <button
                      onClick={handleChangePassword}
                      disabled={changingPwd || !currentPwd || !newPwd || !confirmPwd}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-widest transition-all"
                    >
                      {changingPwd
                        ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Updating…</>
                        : <><Lock className="w-3.5 h-3.5" />Update Password</>
                      }
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card p-10 rounded-[45px] space-y-4 text-center border-dashed border-2 border-white/5">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <ShieldCheck className="w-8 h-8 text-primary/60" />
              </div>
              <h4 className="font-bold text-sm uppercase tracking-widest">Privacy First</h4>
              <p className="text-[10px] text-white/30 leading-relaxed font-medium tracking-wide">COMPLIANT WITH GLOBAL BIOMETRIC DATA PROTECTION STANDARDS</p>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <JoinClassroomModal
        isOpen={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
        onSuccess={loadData}
      />

      {/* Floating Success Message */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100]"
          >
            <div className="bg-emerald-500 text-white px-10 py-5 rounded-full shadow-2xl shadow-emerald-500/40 flex items-center space-x-4 border border-emerald-400/50 backdrop-blur-md">
              <CheckCircle2 className="w-7 h-7 animate-bounce" />
              <div className="flex flex-col">
                <span className="font-black text-sm uppercase tracking-tight">Face Enrollment Active</span>
                <span className="text-[10px] text-white/80 uppercase tracking-widest font-black mt-1">Cloud identity synced</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}

function ShieldCheck({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
