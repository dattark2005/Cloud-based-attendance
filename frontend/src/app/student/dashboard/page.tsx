'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Calendar,
  Plus,
  LayoutGrid,
  ChevronRight,
  Users,
  Clock,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import JoinClassroomModal from '@/components/modals/JoinClassroomModal';
import { useRouter } from 'next/navigation';

interface Section {
  _id: string;
  courseId?: { courseName: string; courseCode: string };
  teacherId?: { fullName: string };
  joinCode?: string;
  students?: string[];
}

interface AttendanceRecord {
  _id: string;
  status: 'PRESENT' | 'ABSENT';
  markedAt: string;
  lectureId?: {
    topic?: string;
    scheduledStart?: string;
    sectionId?: { courseId?: { courseName: string } };
  };
}

export default function StudentDashboard() {
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);
  const [recentLogs, setRecentLogs] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<{ rate: number; total: number; present: number }>({ rate: 0, total: 0, present: 0 });
  const [loading, setLoading] = useState(true);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [historyRes, sectionsRes] = await Promise.all([
        fetchWithAuth('/attendance/history'),
        fetchWithAuth('/sections/student'),
      ]);
      const records: AttendanceRecord[] = historyRes.data?.records || [];
      const statsData = historyRes.data?.stats;
      setSections(sectionsRes.data?.sections || []);
      setRecentLogs(records.slice(0, 8));
      setStats({
        rate: Math.round(statsData?.attendanceRate || 0),
        total: statsData?.total || 0,
        present: statsData?.present || 0,
      });
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <DashboardLayout>
      <div className="space-y-10">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-gradient">My Attendance</h1>
            <p className="text-white/40 text-sm mt-1">View your attendance across all enrolled classrooms.</p>
          </div>
          <button
            onClick={() => setIsJoinModalOpen(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary font-bold text-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            Join a Class
          </button>
        </div>

        {/* ── Stats Row ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            { label: 'Attendance Rate', value: `${stats.rate}%`, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
            { label: 'Classes Attended', value: stats.present, icon: CheckCircle2, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
            { label: 'Total Classes', value: stats.total, icon: Calendar, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`glass-card p-6 rounded-[28px] border ${s.border} flex items-center gap-5`}
              >
                <div className={`w-12 h-12 ${s.bg} rounded-2xl flex items-center justify-center shrink-0`}>
                  <Icon className={`w-6 h-6 ${s.color}`} />
                </div>
                <div>
                  <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">{s.label}</p>
                  <p className="text-2xl font-black mt-0.5">{loading ? '—' : s.value}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Enrolled Classrooms ────────────────────────────── */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black tracking-tight">Enrolled Classrooms</h2>
            <span className="text-xs font-bold text-white/30 px-3 py-1 rounded-full bg-white/5 border border-white/10">
              {sections.length} {sections.length === 1 ? 'class' : 'classes'}
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white/5 animate-pulse rounded-[24px]" />)}
            </div>
          ) : sections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sections.map((sec, i) => (
                <motion.button
                  key={sec._id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => router.push(`/student/classroom/${sec._id}`)}
                  className="glass-card p-6 rounded-[24px] border border-white/8 hover:border-primary/30 text-left transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 bg-primary/15 rounded-xl flex items-center justify-center mb-4">
                      <BookOpen className="w-5 h-5 text-primary" />
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1" />
                  </div>
                  <h3 className="font-black text-sm truncate">
                    {sec.courseId?.courseName || 'Unnamed Course'}
                  </h3>
                  <p className="text-[11px] text-white/40 mt-0.5 truncate">
                    {sec.courseId?.courseCode || ''} · {sec.teacherId?.fullName || 'Teacher'}
                  </p>
                  <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/5">
                    <div className="flex items-center gap-1.5 text-[10px] text-white/30">
                      <Users className="w-3 h-3" />
                      {sec.students?.length ?? 0} students
                    </div>
                    {sec.joinCode && (
                      <div className="flex items-center gap-1.5 text-[10px] text-white/30">
                        <span>Code:</span>
                        <span className="font-bold text-white/50 tracking-widest">{sec.joinCode}</span>
                      </div>
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="glass-card p-14 rounded-[32px] text-center border-2 border-dashed border-white/5 space-y-5">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto">
                <LayoutGrid className="w-8 h-8 text-white/20" />
              </div>
              <div>
                <h4 className="text-lg font-bold">No classrooms yet</h4>
                <p className="text-sm text-white/30 mt-1 max-w-xs mx-auto">Ask your teacher for the class code and join below.</p>
              </div>
              <button onClick={() => setIsJoinModalOpen(true)} className="btn-primary">
                Join Your First Class
              </button>
            </div>
          )}
        </div>

        {/* ── Recent Attendance ──────────────────────────────── */}
        {recentLogs.length > 0 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black tracking-tight">Recent Attendance</h2>
              <button
                onClick={() => router.push('/student/history')}
                className="text-xs font-bold text-primary hover:underline uppercase tracking-widest"
              >
                Full History
              </button>
            </div>

            <div className="space-y-3">
              {recentLogs.map((log, i) => (
                <motion.div
                  key={log._id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center justify-between p-4 rounded-2xl bg-white/4 border border-white/6 hover:bg-white/7 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${log.status === 'PRESENT' ? 'bg-emerald-500/15' : 'bg-rose-500/10'}`}>
                      {log.status === 'PRESENT'
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : <XCircle className="w-4 h-4 text-rose-400" />
                      }
                    </div>
                    <div>
                      <p className="text-sm font-bold leading-tight">
                        {log.lectureId?.sectionId?.courseId?.courseName || log.lectureId?.topic || 'Class'}
                      </p>
                      <p className="text-[11px] text-white/35 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(log.markedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        {' · '}
                        {new Date(log.markedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-black px-3 py-1 rounded-full border ${log.status === 'PRESENT'
                      ? 'border-emerald-500/25 text-emerald-400 bg-emerald-500/8'
                      : 'border-rose-500/20 text-rose-400 bg-rose-500/5'
                    }`}>
                    {log.status}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      <JoinClassroomModal
        isOpen={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
        onSuccess={loadData}
      />
    </DashboardLayout>
  );
}
