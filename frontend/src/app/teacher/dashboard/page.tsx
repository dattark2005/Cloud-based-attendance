'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion } from 'framer-motion';
import {
  Activity, Clock, Users, Plus, LayoutGrid,
  Search, CheckCircle2,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';
import ClassroomCard from '@/components/ClassroomCard';
import CreateClassroomModal from '@/components/modals/CreateClassroomModal';
import { useSession } from '@/providers/SessionProvider';

export default function TeacherDashboard() {
  const { activeSessions, refreshSessions } = useSession();
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    try {
      const [sectionsRes, userRes] = await Promise.all([
        fetchWithAuth('/sections/teacher'),
        fetchWithAuth('/auth/me'),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalStudents = sections.reduce((acc, curr) => acc + (curr.students?.length || 0), 0);

  const stats = [
    { label: 'Total Students', value: totalStudents.toString(), icon: <Users className="text-blue-400" />, trend: 'Enrolled' },
    { label: 'My Classrooms', value: sections.length.toString(), icon: <LayoutGrid className="text-red-400" />, trend: 'Active' },
    { label: 'Live Sessions', value: activeSessions.length.toString(), icon: <Clock className="text-amber-400" />, trend: 'Active Now' },
    { label: 'Avg Attendance', value: '0%', icon: <Activity className="text-emerald-500" />, trend: 'N/A' },
  ];

  const filteredSections = sections.filter(s =>
    !searchQuery ||
    s.courseId?.courseName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.sectionName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-10">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-gradient">Teacher Dashboard</h1>
            <p className="text-white/40 text-sm font-medium mt-1">
              Welcome back{userData?.fullName ? `, ${userData.fullName.split(' ')[0]}` : ''}! Open a classroom to mark your attendance and schedule lectures.
            </p>
          </div>
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

        {/* ─── Info banner: attendance lives inside classrooms ─── */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-4 p-5 rounded-[24px] bg-amber-500/8 border border-amber-500/20"
        >
          <div className="p-2.5 rounded-xl bg-amber-500/15 shrink-0">
            <CheckCircle2 className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-300">Attendance is managed inside each classroom</p>
            <p className="text-xs text-white/40">Click on any classroom card below → go to its detail page → mark your attendance or schedule lectures there.</p>
          </div>
        </motion.div>

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
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search classes..."
                className="bg-transparent border-none text-xs focus:outline-none placeholder:text-white/10 text-white"
              />
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {[1, 2, 3].map(i => <div key={i} className="h-[280px] bg-white/5 animate-pulse rounded-[35px]" />)}
            </div>
          ) : filteredSections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {filteredSections.map((section) => {
                const isOngoing = activeSessions.some(
                  s => s.sectionId?._id === section._id || s.sectionId === section._id
                );
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
          ) : sections.length === 0 ? (
            <div className="glass-card p-16 rounded-[50px] text-center border-2 border-dashed border-white/5 space-y-6">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <LayoutGrid className="w-10 h-10 text-primary/40" />
              </div>
              <div className="space-y-2">
                <h4 className="text-xl font-bold">No classrooms found</h4>
                <p className="text-sm text-white/30 max-w-sm mx-auto">
                  Create a classroom to share the code with students and start tracking attendance.
                </p>
              </div>
              <button onClick={() => setIsModalOpen(true)} className="btn-primary">
                Create My First Class
              </button>
            </div>
          ) : (
            <div className="text-center py-12 text-white/30">
              No classrooms match your search.
            </div>
          )}
        </div>

        {/* ── Infrastructure Health ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6">
          <div className="glass-card p-10 rounded-[45px] space-y-6">
            <h3 className="text-xl font-bold tracking-tight">Infrastructure Health</h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="p-8 rounded-[35px] bg-emerald-500/5 border border-emerald-500/10 flex flex-col items-center justify-center space-y-3 text-center">
                <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
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
    </DashboardLayout>
  );
}
