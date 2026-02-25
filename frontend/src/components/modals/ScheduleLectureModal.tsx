'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, BookOpen, MapPin, FileText, CheckCircle2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

interface ScheduleLectureModalProps {
    isOpen: boolean;
    onClose: () => void;
    sectionId: string;
    onSuccess?: () => void;
}

export default function ScheduleLectureModal({
    isOpen,
    onClose,
    sectionId,
    onSuccess,
}: ScheduleLectureModalProps) {
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        topic: '',
        date: '',
        startTime: '',
        endTime: '',
        roomNumber: '',
        notes: '',
    });

    const resetForm = () =>
        setForm({ topic: '', date: '', startTime: '', endTime: '', roomNumber: '', notes: '' });

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.date || !form.startTime || !form.endTime) {
            toast.error('Please fill in date and time fields');
            return;
        }

        const scheduledStart = new Date(`${form.date}T${form.startTime}`).toISOString();
        const scheduledEnd = new Date(`${form.date}T${form.endTime}`).toISOString();

        if (new Date(scheduledStart) >= new Date(scheduledEnd)) {
            toast.error('End time must be after start time');
            return;
        }

        setLoading(true);
        try {
            const res = await fetchWithAuth(`/sections/${sectionId}/lectures`, {
                method: 'POST',
                body: JSON.stringify({
                    topic: form.topic || 'General Lecture',
                    scheduledStart,
                    scheduledEnd,
                    roomNumber: form.roomNumber,
                    notes: form.notes,
                }),
            });

            if (res.success) {
                toast.success('📅 Lecture scheduled successfully!');
                resetForm();
                onSuccess?.();
                onClose();
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to schedule lecture');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/75 backdrop-blur-lg"
                        onClick={handleClose}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.93, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.93, y: 24 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                        className="relative z-10 w-full max-w-lg"
                    >
                        <div className="glass-card rounded-[40px] overflow-hidden border border-white/10 shadow-2xl shadow-black/50">

                            {/* Header */}
                            <div className="relative px-8 pt-8 pb-5">
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-20 bg-gradient-to-b from-primary/20 to-transparent rounded-full blur-2xl pointer-events-none" />
                                <div className="relative flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 rounded-2xl bg-primary/15 border border-primary/20">
                                            <Calendar className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-black tracking-tight">Schedule Lecture</h2>
                                            <p className="text-[11px] text-white/40">Add a lecture to the classroom schedule</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleClose}
                                        className="p-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all"
                                    >
                                        <X className="w-4 h-4 text-white/60" />
                                    </button>
                                </div>
                            </div>

                            {/* Form */}
                            <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-4">

                                {/* Topic */}
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                                        <BookOpen className="w-3 h-3" /> Topic / Subject
                                    </label>
                                    <input
                                        type="text"
                                        value={form.topic}
                                        onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                                        placeholder="e.g. Introduction to Data Structures"
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-all"
                                    />
                                </div>

                                {/* Date */}
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3" /> Date <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        required
                                        value={form.date}
                                        onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-all [color-scheme:dark]"
                                    />
                                </div>

                                {/* Start / End Time */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                                            <Clock className="w-3 h-3" /> Start <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            type="time"
                                            required
                                            value={form.startTime}
                                            onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-all [color-scheme:dark]"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                                            <Clock className="w-3 h-3" /> End <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            type="time"
                                            required
                                            value={form.endTime}
                                            onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-all [color-scheme:dark]"
                                        />
                                    </div>
                                </div>

                                {/* Room Number */}
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                                        <MapPin className="w-3 h-3" /> Room Number
                                    </label>
                                    <input
                                        type="text"
                                        value={form.roomNumber}
                                        onChange={e => setForm(f => ({ ...f, roomNumber: e.target.value }))}
                                        placeholder="e.g. A-201"
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-all"
                                    />
                                </div>

                                {/* Notes */}
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                                        <FileText className="w-3 h-3" /> Notes <span className="text-white/20">(optional)</span>
                                    </label>
                                    <textarea
                                        value={form.notes}
                                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                        placeholder="Additional instructions or notes for students..."
                                        rows={2}
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-all resize-none"
                                    />
                                </div>

                                {/* Submit */}
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={handleClose}
                                        className="flex-1 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="flex-[2] flex items-center justify-center gap-2 bg-primary hover:bg-primary-glow disabled:opacity-50 text-white py-3.5 rounded-2xl font-bold text-sm transition-all shadow-lg shadow-primary/20"
                                    >
                                        {loading ? (
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <>
                                                <CheckCircle2 className="w-4 h-4" />
                                                Schedule Lecture
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
