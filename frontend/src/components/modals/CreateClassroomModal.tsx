'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, LayoutGrid, BookOpen, Hash, Calendar, GraduationCap, ArrowRight, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

interface CreateClassroomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CreateClassroomModal({ isOpen, onClose, onSuccess }: CreateClassroomModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    courseName: '',
    courseCode: '',
    sectionName: '',
    academicYear: new Date().getFullYear().toString(),
    semester: '1'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.courseName || !formData.sectionName) {
      toast.error('Course Name and Section Name are required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetchWithAuth('/sections/create', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      if (res.success) {
        toast.success('Classroom created successfully!');
        if (onSuccess) onSuccess();
        onClose();
        setFormData({
          courseName: '',
          courseCode: '',
          sectionName: '',
          academicYear: new Date().getFullYear().toString(),
          semester: '1'
        });
      } else {
        toast.error(res.message || 'Failed to create classroom');
      }
    } catch (err) {
      toast.error('An error occurred');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg glass-card rounded-[35px] border border-white/10 overflow-hidden shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-6 sm:p-8 pb-6 border-b border-white/5 relative bg-white/5">
              <button
                onClick={onClose}
                className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center mb-4 border border-primary/20">
                <LayoutGrid className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-2xl font-black tracking-tight">Create Classroom</h2>
              <p className="text-sm text-white/40 mt-1">Set up a new space for your students</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 sm:p-8 flex-1 overflow-y-auto space-y-6">
              
              {/* Course details */}
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5 block">Course Name</label>
                  <div className="relative">
                    <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <input
                      type="text"
                      required
                      value={formData.courseName}
                      onChange={e => setFormData({ ...formData, courseName: e.target.value })}
                      className="w-full bg-black/20 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/20 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all outline-none"
                      placeholder="e.g. Advanced Deep Learning"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5 block">Course Code</label>
                    <div className="relative">
                      <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <input
                        type="text"
                        value={formData.courseCode}
                        onChange={e => setFormData({ ...formData, courseCode: e.target.value })}
                        className="w-full bg-black/20 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/20 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all outline-none"
                        placeholder="e.g. CS-601"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5 block">Section</label>
                    <div className="relative">
                      <LayoutGrid className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <input
                        type="text"
                        required
                        value={formData.sectionName}
                        onChange={e => setFormData({ ...formData, sectionName: e.target.value })}
                        className="w-full bg-black/20 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/20 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all outline-none"
                        placeholder="e.g. Div A / Lab 1"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5 block">Academic Year</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <input
                        type="text"
                        value={formData.academicYear}
                        onChange={e => setFormData({ ...formData, academicYear: e.target.value })}
                        className="w-full bg-black/20 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white focus:border-primary/50 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5 block">Semester</label>
                    <div className="relative">
                      <GraduationCap className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <select
                        value={formData.semester}
                        onChange={e => setFormData({ ...formData, semester: e.target.value })}
                        className="w-full bg-black/20 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white focus:border-primary/50 outline-none appearance-none"
                      >
                        {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s.toString()} className="bg-black text-white">Semester {s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 px-4 rounded-2xl border border-white/10 text-white/60 hover:bg-white/5 hover:text-white transition-all text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] btn-primary py-3 rounded-2xl flex items-center justify-center gap-2 group disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    <>
                      <span>Create Classroom</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </div>

            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
