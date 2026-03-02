'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Copy, ChevronRight, Plus, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';

interface ClassroomCardProps {
  section: any;
  role: 'TEACHER' | 'STUDENT';
  isOngoing?: boolean;
  onRefresh?: () => void;
}

export default function ClassroomCard({ section, role, isOngoing, onRefresh }: ClassroomCardProps) {
  const [sessionLoading, setSessionLoading] = useState(false);
  const router = useRouter();

  const copyCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(section.joinCode);
    toast.success('Join code copied to clipboard!');
  };

  const handleSessionAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionLoading(true);
    try {
      const action = isOngoing ? 'end-session' : 'start-session';
      const res = await fetchWithAuth(`/sections/${section._id}/${action}`, { method: 'POST' });
      if (res.success) {
        toast.success(isOngoing ? 'Session ended' : 'Session started!');
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setSessionLoading(false);
    }
  };

  const handleOpenClassroom = () => {
    if (role === 'TEACHER') {
      router.push(`/teacher/classroom/${section._id}`);
    } else {
      if (isOngoing) {
        router.push(`/student/session/active?sectionId=${section._id}`);
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      className={`glass-card p-6 rounded-[35px] border-white/5 hover:border-primary/20 transition-all group relative overflow-hidden cursor-pointer ${isOngoing ? 'ring-2 ring-primary/50' : ''}`}
      onClick={handleOpenClassroom}
    >
      {isOngoing && (
        <div className="absolute top-4 left-4 z-10">
          <div className="flex items-center space-x-2 px-3 py-1 bg-primary rounded-full animate-pulse shadow-lg shadow-primary/40">
            <div className="w-1.5 h-1.5 bg-white rounded-full" />
            <span className="text-[8px] font-black text-white uppercase tracking-widest">Live Now</span>
          </div>
        </div>
      )}

      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-primary/10 transition-all" />

      <div className="space-y-6 relative">
        {/* Course Info */}
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h4 className="text-xl font-bold tracking-tight group-hover:text-primary transition-colors">
              {section.courseId?.courseName || 'Unknown Course'}
            </h4>
            <div className="flex items-center space-x-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">
              <span>{section.courseId?.courseCode}</span>
              <span>•</span>
              <span>{section.sectionName}</span>
            </div>
          </div>
          <div className="p-3 bg-white/5 rounded-2xl border border-white/5">
            <Users className="w-5 h-5 text-primary" />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-white/5 rounded-2xl border border-white/5 space-y-1">
            <p className="text-[8px] text-white/40 uppercase font-black tracking-tighter">Semester</p>
            <p className="text-xs font-bold">{section.semester} {section.academicYear}</p>
          </div>
          <div className="p-3 bg-white/5 rounded-2xl border border-white/5 space-y-1">
            <p className="text-[8px] text-white/40 uppercase font-black tracking-tighter">Students</p>
            <p className="text-xs font-bold">{section.students?.length || 0} Enrolled</p>
          </div>
        </div>

        {role === 'TEACHER' ? (
          <div className="space-y-3">
            {/* Join Code */}
            <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/10 rounded-2xl">
              <div>
                <p className="text-[8px] text-primary/60 uppercase font-black">Class Code</p>
                <p className="text-lg font-black tracking-widest uppercase">{section.joinCode}</p>
              </div>
              <button onClick={copyCode} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                <Copy className="w-4 h-4 text-primary" />
              </button>
            </div>

            {/* View Classroom (primary action) */}
            <button
              onClick={handleOpenClassroom}
              className="w-full py-4 rounded-2xl border flex items-center justify-center space-x-2 transition-all text-[10px] font-black uppercase tracking-widest bg-primary text-white border-primary/20 hover:bg-primary-glow"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open Classroom</span>
            </button>

            {/* Session control */}
            <button
              disabled={sessionLoading}
              onClick={handleSessionAction}
              className={`w-full py-3 rounded-2xl border flex items-center justify-center space-x-2 transition-all text-[10px] font-black uppercase tracking-widest ${isOngoing
                ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                }`}
            >
              {sessionLoading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{isOngoing ? 'End Live Session' : 'Start Instant Session'}</span>
                  {!isOngoing && <Plus className="w-4 h-4" />}
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center space-x-3 p-3 bg-white/5 rounded-2xl">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                {section.teacherId?.fullName?.charAt(0)}
              </div>
              <div>
                <p className="text-[8px] text-white/40 uppercase font-black">Instructor</p>
                <p className="text-xs font-bold truncate">{section.teacherId?.fullName}</p>
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); if (isOngoing) router.push(`/student/session/active?sectionId=${section._id}`); }}
              disabled={!isOngoing}
              className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center space-x-2 transition-all ${isOngoing
                ? 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-lg shadow-emerald-500/20'
                : 'bg-white/5 text-white/40 border border-white/5 cursor-not-allowed'
                }`}
            >
              <span>{isOngoing ? 'Enter Live Session' : 'No Active Session'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
