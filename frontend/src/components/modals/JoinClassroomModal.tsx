'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, KeyRound, Sparkles } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

interface JoinClassroomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function JoinClassroomModal({ isOpen, onClose, onSuccess }: JoinClassroomModalProps) {
  const [loading, setLoading] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.length < 6) {
      toast.error('Class code must be exactly 6 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await fetchWithAuth('/sections/join', {
        method: 'POST',
        body: JSON.stringify({ joinCode })
      });

      if (res.success) {
        toast.success(`Success! You joined ${res.data.section.sectionName}`);
        onSuccess();
        onClose();
        setJoinCode('');
      }
    } catch (err: any) {
      toast.error(err.message || 'Invalid class code');
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
            className="relative w-full max-w-md glass-card p-12 rounded-[50px] border-white/10 shadow-2xl text-center space-y-8"
          >
            <div className="mx-auto w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center">
              <KeyRound className="w-10 h-10 text-primary" />
            </div>

            <div className="space-y-2">
              <h2 className="text-3xl font-bold tracking-tight">Join a Class</h2>
              <p className="text-sm text-white/40 leading-relaxed font-medium">Enter the 6-character code provided by your teacher to synchronize your biometric profile.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="relative group">
                <input 
                  required
                  type="text"
                  maxLength={6}
                  placeholder="CODE24"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="w-full bg-white/5 border-2 border-dashed border-white/10 rounded-3xl py-6 text-2xl font-black text-center tracking-[1em] focus:outline-none focus:border-primary/50 focus:bg-white/10 transition-all uppercase placeholder:opacity-20"
                />
                <Sparkles className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 text-primary animate-pulse" />
              </div>

              <div className="pt-4">
                <button 
                  disabled={loading || joinCode.length < 6}
                  type="submit"
                  className="w-full py-5 rounded-3xl bg-primary text-white font-bold text-xs uppercase tracking-widest hover:bg-primary-glow transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                >
                  {loading ? 'Verifying Code...' : 'Sync and Join'}
                </button>
                <button 
                  type="button"
                  onClick={onClose}
                  className="mt-4 text-[10px] font-bold text-white/20 uppercase tracking-widest hover:text-white/40 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
