'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Copy, ExternalLink, Calendar, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchWithAuth } from '@/lib/api';

interface ClassroomCardProps {
  section: any;
  role: 'TEACHER' | 'STUDENT';
  isOngoing?: boolean;
  onRefresh?: () => void;
}

export default function ClassroomCard({ section, role, isOngoing, onRefresh }: ClassroomCardProps) {
  const [sessionLoading, setSessionLoading] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(section.joinCode);
    toast.success('Join code copied to clipboard!');
  };

  const handleSessionAction = async () => {
    setSessionLoading(true);
    try {
      const action = isOngoing ? 'end-session' : 'start-session';
      const res = await fetchWithAuth(`/sections/${section._id}/${action}`, {
        method: 'POST'
      });
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

  const handleEnterSession = () => {
    if (role === 'TEACHER') {
      // Find the active session for this section
      // In a real app we'd get the lectureId from the parent or a context
      // For now, if isOngoing is true, we know there is one
      // I'll update the component to accept a lectureId prop or just navigate to a section-based search
      window.location.href = `/teacher/session/active?sectionId=${section._id}`;
    } else {
      window.location.href = `/student/session/active?sectionId=${section._id}`;
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card p-6 rounded-[35px] border-white/5 hover:border-primary/20 transition-all group relative overflow-hidden ${isOngoing ? 'ring-2 ring-primary/50' : ''}`}
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
            <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/10 rounded-2xl">
              <div>
                <p className="text-[8px] text-primary/60 uppercase font-black">Class Code</p>
                <p className="text-lg font-black tracking-widest uppercase">{section.joinCode}</p>
              </div>
              <button 
                onClick={copyCode}
                className="p-2 hover:bg-white/10 rounded-xl transition-all"
              >
                <Copy className="w-4 h-4 text-primary" />
              </button>
            </div>
            <button 
              disabled={sessionLoading}
              onClick={isOngoing ? handleEnterSession : handleSessionAction}
              className={`w-full py-4 rounded-2xl border flex items-center justify-center space-x-2 transition-all text-[10px] font-black uppercase tracking-widest ${
                isOngoing 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500 hover:text-white' 
                : 'bg-primary text-white border-primary/20 hover:bg-primary-glow'
              }`}
            >
              {sessionLoading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{isOngoing ? 'Manage Live Session' : 'Start Live Session'}</span>
                  {isOngoing ? <ChevronRight className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
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
              onClick={handleEnterSession}
              disabled={!isOngoing}
              className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center space-x-2 transition-all ${
              isOngoing 
              ? 'bg-emerald-500 text-white hover:bg-emerald-400 brightness-110 shadow-lg shadow-emerald-500/20' 
              : 'bg-white/5 text-white/40 border border-white/5 cursor-not-allowed'
            }`}>
              <span>{isOngoing ? 'Enter Live Session' : 'No Active Session'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
