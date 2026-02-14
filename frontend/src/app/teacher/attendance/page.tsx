'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Clock, CheckCircle2, AlertCircle, Play, ArrowRight, Activity, RefreshCw } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

export default function TeacherAttendance() {
  const [lectures, setLectures] = useState<any[]>([]);
  const [selectedLecture, setSelectedLecture] = useState<any>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [attendanceData, setAttendanceData] = useState<any>(null);

  // Mock lectures for now
  useEffect(() => {
    setLectures([
      { id: '1', name: 'Deep Learning', code: 'CS601', time: '10:00 AM - 11:30 AM', students: 45 },
      { id: '2', name: 'Neural Networks', code: 'CS602', time: '02:00 PM - 03:30 PM', students: 38 },
    ]);
  }, []);

  const triggerAttendance = async () => {
    if (!selectedLecture) return;
    setIsRequesting(true);
    try {
      const res = await fetchWithAuth('/attendance/request', {
        method: 'POST',
        body: JSON.stringify({ lectureId: selectedLecture.id, durationMinutes: 10 }),
      });
      toast.success('Attendance window opened for 10 minutes');
      startPolling(selectedLecture.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to trigger attendance');
    } finally {
      setIsRequesting(false);
    }
  };

  const startPolling = (lectureId: string) => {
    // In real app, use WebSockets. Polling for demo.
    const interval = setInterval(async () => {
      try {
        const res = await fetchWithAuth(`/attendance/status/${lectureId}`);
        setAttendanceData(res.data);
      } catch (e) {}
    }, 3000);
    return () => clearInterval(interval);
  };

  return (
    <DashboardLayout>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lecture Selection */}
        <div className="lg:col-span-1 space-y-6">
          <h3 className="text-xl font-bold flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <span>Active Lectures</span>
          </h3>
          <div className="space-y-4">
            {lectures.map((lec) => (
              <button
                key={lec.id}
                onClick={() => setSelectedLecture(lec)}
                className={`w-full glass-card p-6 rounded-3xl text-left border-2 transition-all ${
                  selectedLecture?.id === lec.id ? 'border-primary ring-4 ring-primary/10' : 'border-white/5'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold text-white/50">{lec.code}</span>
                  <Clock className="w-4 h-4 text-white/20" />
                </div>
                <h4 className="text-lg font-bold">{lec.name}</h4>
                <p className="text-sm text-white/40 mb-4">{lec.time}</p>
                <div className="flex items-center text-xs text-primary font-bold">
                  <Users className="w-4 h-4 mr-2" />
                  <span>{lec.students} Registered</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Action Center */}
        <div className="lg:col-span-2 space-y-8">
          {selectedLecture ? (
            <AnimatePresence mode="wait">
              <motion.div 
                key={selectedLecture.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-8 rounded-[40px] border border-primary/20 space-y-8"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-2xl font-bold italic text-gradient">Session: {selectedLecture.name}</h2>
                    <p className="text-white/40">Ready to initiate biometric capture?</p>
                  </div>
                  <button 
                    onClick={triggerAttendance}
                    disabled={isRequesting}
                    className="btn-primary flex items-center space-x-2 px-8 py-4"
                  >
                    {isRequesting ? <RefreshCw className="animate-spin" /> : <Play className="w-5 h-5 fill-white" />}
                    <span>Start Biometric Window</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-6 rounded-3xl bg-white/5 border border-white/5 space-y-1">
                    <p className="text-xs text-white/40 font-bold uppercase">Present</p>
                    <p className="text-4xl font-bold text-emerald-500">{attendanceData?.stats.present || 0}</p>
                  </div>
                  <div className="p-6 rounded-3xl bg-white/5 border border-white/5 space-y-1">
                    <p className="text-xs text-white/40 font-bold uppercase">Activity Logs</p>
                    <p className="text-4xl font-bold text-primary">{attendanceData?.stats.marked || 0}</p>
                  </div>
                  <div className="p-6 rounded-3xl bg-white/5 border border-white/5 space-y-1">
                    <p className="text-xs text-white/40 font-bold uppercase">In Class</p>
                    <div className="flex items-center space-x-2">
                      <p className="text-4xl font-bold text-secondary">
                        {attendanceData?.stats.totalStudents - attendanceData?.absentStudents.length || 0}
                      </p>
                      <Activity className="w-5 h-5 text-secondary animate-pulse" />
                    </div>
                  </div>
                </div>

                {attendanceData && (
                  <div className="space-y-4">
                    <h4 className="font-bold flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span>Live Verification Feed</span>
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                      {attendanceData.attendanceRecords.map((rec: any) => (
                        <div key={rec._id} className="relative group overflow-hidden rounded-2xl aspect-square glass-card border-emerald-500/30">
                          <img src={rec.faceImageUrl || '/placeholder.png'} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                            <p className="text-[8px] font-bold text-white truncate">{rec.studentId.fullName}</p>
                            <p className="text-[6px] text-emerald-400 font-bold">{Math.round(rec.confidenceScore * 100)}% Match</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center space-y-4 glass-card rounded-[40px] opacity-50">
              <AlertCircle className="w-16 h-16 text-white/20" />
              <div>
                <h2 className="text-xl font-bold">No Lecture Selected</h2>
                <p className="text-sm text-white/30">Select a course from the left panel to begin</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

// Support Icon Helper for this file
const BookOpen = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
);
