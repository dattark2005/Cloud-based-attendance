'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  TrendingUp,
  Filter,
  Search,
  ChevronLeft,
  BookOpen,
  BarChart3,
  AlertCircle,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';

interface AttendanceRecord {
  _id: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE';
  markedAt: string;
  confidenceScore?: number;
  verificationMethod?: string;
  lectureId?: {
    _id?: string;
    topic?: string;
    scheduledStart?: string;
    sectionId?: {
      _id?: string;
      courseId?: { courseName: string; courseCode: string };
    };
  };
}

interface Stats {
  total: number;
  present: number;
  late: number;
  attendanceRate: number;
}

const STATUS_COLORS = {
  PRESENT: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle2 },
  LATE:    { bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400',   icon: Clock },
  ABSENT:  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-400',    icon: XCircle },
};

export default function StudentHistoryPage() {
  const router = useRouter();
  const [records, setRecords]       = useState<AttendanceRecord[]>([]);
  const [stats, setStats]           = useState<Stats>({ total: 0, present: 0, late: 0, attendanceRate: 0 });
  const [loading, setLoading]       = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT' | 'LATE'>('ALL');
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth('/attendance/history');
      const recs: AttendanceRecord[] = res.data?.records || [];
      const s = res.data?.stats;
      setRecords(recs);
      setStats({
        total: s?.total || recs.length,
        present: s?.present || recs.filter(r => r.status === 'PRESENT').length,
        late: s?.late || recs.filter(r => r.status === 'LATE').length,
        attendanceRate: parseFloat(s?.attendanceRate || '0'),
      });
    } catch {
      toast.error('Failed to load attendance history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Unique course list for filter dropdown
  const courses = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string }[] = [];
    records.forEach(r => {
      const id   = r.lectureId?.sectionId?._id || '';
      const name = r.lectureId?.sectionId?.courseId?.courseName || '';
      if (id && name && !seen.has(id)) { seen.add(id); list.push({ id, name }); }
    });
    return list;
  }, [records]);

  // Filtered + searched records
  const filtered = useMemo(() => {
    return records.filter(r => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (courseFilter !== 'ALL' && r.lectureId?.sectionId?._id !== courseFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const courseName = r.lectureId?.sectionId?.courseId?.courseName?.toLowerCase() || '';
        const topic      = r.lectureId?.topic?.toLowerCase() || '';
        const code       = r.lectureId?.sectionId?.courseId?.courseCode?.toLowerCase() || '';
        if (!courseName.includes(q) && !topic.includes(q) && !code.includes(q)) return false;
      }
      return true;
    });
  }, [records, statusFilter, courseFilter, searchQuery]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [statusFilter, courseFilter, searchQuery]);

  const rateColor = stats.attendanceRate >= 75 ? 'text-emerald-400' : stats.attendanceRate >= 50 ? 'text-amber-400' : 'text-rose-400';

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-5xl mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center transition-all"
            >
              <ChevronLeft className="w-5 h-5 text-white/60" />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-gradient">Attendance History</h1>
              <p className="text-white/40 text-sm mt-0.5">Your complete attendance record across all classes</p>
            </div>
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Attendance Rate', value: `${stats.attendanceRate}%`, icon: TrendingUp, color: rateColor, bg: 'bg-white/5', border: 'border-white/8' },
            { label: 'Total Classes', value: stats.total, icon: Calendar, color: 'text-blue-400', bg: 'bg-blue-500/5', border: 'border-blue-500/15' },
            { label: 'Present', value: stats.present, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/15' },
            { label: 'Late', value: stats.late, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/15' },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={`glass-card p-5 rounded-[22px] border ${s.border} ${s.bg}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{s.label}</p>
                  <Icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <p className={`text-2xl font-black ${s.color}`}>{loading ? '—' : s.value}</p>
              </motion.div>
            );
          })}
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              placeholder="Search by course or topic..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm text-white placeholder-white/25 focus:outline-none focus:border-primary/40 transition-all"
            />
          </div>

          {/* Status filter */}
          <div className="relative">
            <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="pl-10 pr-8 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-primary/40 appearance-none cursor-pointer"
            >
              <option value="ALL" className="bg-[#0f1117]">All Status</option>
              <option value="PRESENT" className="bg-[#0f1117]">Present</option>
              <option value="LATE" className="bg-[#0f1117]">Late</option>
              <option value="ABSENT" className="bg-[#0f1117]">Absent</option>
            </select>
          </div>

          {/* Course filter */}
          {courses.length > 1 && (
            <div className="relative">
              <BookOpen className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
              <select
                value={courseFilter}
                onChange={e => setCourseFilter(e.target.value)}
                className="pl-10 pr-8 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-primary/40 appearance-none cursor-pointer max-w-[200px]"
              >
                <option value="ALL" className="bg-[#0f1117]">All Courses</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id} className="bg-[#0f1117]">{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Records List ── */}
        <div className="space-y-3">
          {/* Count badge */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/40 font-medium">
              {loading ? 'Loading...' : `${filtered.length} record${filtered.length !== 1 ? 's' : ''}`}
            </p>
            {filtered.length !== records.length && (
              <button onClick={() => { setStatusFilter('ALL'); setCourseFilter('ALL'); setSearchQuery(''); }} className="text-xs text-primary hover:underline font-semibold">
                Clear filters
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 bg-white/4 animate-pulse rounded-2xl" />
              ))}
            </div>
          ) : paginated.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-card p-16 rounded-[28px] text-center border border-white/5 space-y-4"
            >
              <div className="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center mx-auto">
                {records.length === 0 ? <BarChart3 className="w-7 h-7 text-white/20" /> : <AlertCircle className="w-7 h-7 text-white/20" />}
              </div>
              <div>
                <h3 className="font-bold text-white/60">
                  {records.length === 0 ? 'No attendance records yet' : 'No records match your filters'}
                </h3>
                <p className="text-sm text-white/30 mt-1">
                  {records.length === 0 ? 'Your attendance history will appear here once classes begin.' : 'Try adjusting your search or filters.'}
                </p>
              </div>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {paginated.map((log, i) => {
                const s = STATUS_COLORS[log.status] || STATUS_COLORS.ABSENT;
                const Icon = s.icon;
                const courseName = log.lectureId?.sectionId?.courseId?.courseName || log.lectureId?.topic || 'Class';
                const courseCode = log.lectureId?.sectionId?.courseId?.courseCode || '';
                const date = new Date(log.markedAt);

                return (
                  <motion.div
                    key={log._id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ delay: i * 0.02 }}
                    className={`flex items-center justify-between p-4 rounded-2xl border ${s.border} ${s.bg} hover:brightness-110 transition-all`}
                  >
                    {/* Left: icon + info */}
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${s.bg} border ${s.border}`}>
                        <Icon className={`w-5 h-5 ${s.text}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate leading-tight">{courseName}</p>
                        <p className="text-[11px] text-white/35 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          {courseCode && <span className="font-semibold text-white/50">{courseCode}</span>}
                          {courseCode && <span>·</span>}
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* Right: status badge */}
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      {log.confidenceScore != null && log.confidenceScore > 0 && (
                        <span className="text-[10px] text-white/25 font-medium hidden sm:block">
                          {Math.round(log.confidenceScore * 100)}% conf
                        </span>
                      )}
                      <span className={`text-[10px] font-black px-3 py-1.5 rounded-full border ${s.border} ${s.text} ${s.bg}`}>
                        {log.status}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-white/50 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && (arr[idx - 1] as number) + 1 < p) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`dot-${i}`} className="px-2 text-white/20 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`w-9 h-9 rounded-xl text-sm font-black transition-all ${
                      page === p
                        ? 'bg-primary text-black'
                        : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/10'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-white/50 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
