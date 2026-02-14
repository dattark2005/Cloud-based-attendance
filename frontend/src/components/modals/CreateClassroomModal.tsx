'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BookOpen, Hash, Layers, Calendar, Clock, PlusCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

interface CreateClassroomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateClassroomModal({ isOpen, onClose, onSuccess }: CreateClassroomModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    courseName: '',
    courseCode: '',
    sectionName: '',
    academicYear: new Date().getFullYear().toString(),
    semester: 'Fall'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetchWithAuth('/sections/create', {
        method: 'POST',
        body: JSON.stringify(formData)
      });

      if (res.success) {
        toast.success(`Classroom created! Code: ${res.data.joinCode}`);
        onSuccess();
        onClose();
        setFormData({
          courseName: '',
          courseCode: '',
          sectionName: '',
          academicYear: new Date().getFullYear().toString(),
          semester: 'Fall'
        });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create classroom');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-lg glass-card p-10 rounded-[40px] border-white/10 shadow-2xl space-y-8"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-primary/20 rounded-2xl">
                  <PlusCircle className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Create Classroom</h2>
                  <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Setup a new academic session</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-all"
              >
                <X className="w-6 h-6 text-white/40" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-6">
              <div className="col-span-2 space-y-2">
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest ml-4">Course Name</label>
                <div className="relative group">
                  <BookOpen className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-primary transition-all" />
                  <input 
                    required
                    type="text"
                    placeholder="e.g. Deep Learning"
                    value={formData.courseName}
                    onChange={(e) => setFormData({...formData, courseName: e.target.value})}
                    className="w-full bg-white/5 border border-white/5 rounded-3xl py-4 pl-14 pr-6 text-sm focus:outline-none focus:border-primary/50 transition-all"
                  />
                </div>
              </div>

              {/* Course code is auto-generated */}

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest ml-4">Section / Div</label>
                <div className="relative group">
                  <Layers className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-primary transition-all" />
                  <input 
                    required
                    type="text"
                    placeholder="Division A"
                    value={formData.sectionName}
                    onChange={(e) => setFormData({...formData, sectionName: e.target.value})}
                    className="w-full bg-white/5 border border-white/5 rounded-3xl py-4 pl-14 pr-6 text-sm focus:outline-none focus:border-primary/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest ml-4">Academic Year</label>
                <div className="relative group">
                  <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-primary transition-all" />
                  <input 
                    required
                    type="text"
                    placeholder="2024-25"
                    value={formData.academicYear}
                    onChange={(e) => setFormData({...formData, academicYear: e.target.value})}
                    className="w-full bg-white/5 border border-white/5 rounded-3xl py-4 pl-14 pr-6 text-sm focus:outline-none focus:border-primary/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest ml-4">Semester</label>
                <div className="relative group">
                  <Clock className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-primary transition-all" />
                  <select 
                    value={formData.semester}
                    onChange={(e) => setFormData({...formData, semester: e.target.value})}
                    className="w-full bg-white/5 border border-white/5 rounded-3xl py-4 pl-14 pr-6 text-sm focus:outline-none focus:border-primary/50 transition-all appearance-none"
                  >
                    <option value="Fall">Fall</option>
                    <option value="Spring">Spring</option>
                    <option value="Summer">Summer</option>
                  </select>
                </div>
              </div>

              <button 
                disabled={loading}
                type="submit"
                className="col-span-2 mt-4 py-4 rounded-3xl bg-primary text-white font-bold text-xs uppercase tracking-widest hover:bg-primary-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating...' : 'Launch Classroom'}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
