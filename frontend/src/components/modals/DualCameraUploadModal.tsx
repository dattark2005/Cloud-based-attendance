import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UploadCloud, Video, AlertCircle, CheckCircle2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

interface DualCameraUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    lectureId: string;
    onSuccess: () => void;
}

export default function DualCameraUploadModal({ isOpen, onClose, lectureId, onSuccess }: DualCameraUploadModalProps) {
    const [insideFile, setInsideFile] = useState<File | null>(null);
    const [outsideFile, setOutsideFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    if (!isOpen) return null;

    const handleProcess = async () => {
        if (!insideFile || !outsideFile) {
            toast.error('Both INSIDE and OUTSIDE videos are required.');
            return;
        }

        setIsProcessing(true);
        const toastId = toast.loading('Uploading and computing attendance... (This may take a few minutes)');

        try {
            const formData = new FormData();
            formData.append('insideVideo', insideFile);
            formData.append('outsideVideo', outsideFile);

            const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
            if (!token) throw new Error('Not authenticated');

            const res = await fetch(`http://localhost:3001/api/door/process-videos/${lectureId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const data = await res.json();
            if (data.success) {
                toast.success(`Processed! Analyzed attendance for ${data.data.length} students.`, { id: toastId });
                setInsideFile(null);
                setOutsideFile(null);
                onSuccess();
                onClose();
            } else {
                throw new Error(data.message || 'Processing failed');
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to process videos', { id: toastId });
        } finally {
            setIsProcessing(false);
        }
    };

    const UploadBox = ({ title, file, setFile, type }: any) => (
        <div className="relative group rounded-3xl border-2 border-dashed border-white/10 p-6 flex flex-col items-center justify-center gap-3 transition-all hover:bg-white/5 hover:border-primary/40">
            <input
                type="file"
                accept="video/mp4,video/webm,video/mov"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                disabled={isProcessing}
            />
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${file ? 'bg-emerald-500/20 text-emerald-400' : 'bg-primary/10 text-primary'}`}>
                {file ? <CheckCircle2 className="w-6 h-6" /> : <Video className="w-6 h-6" />}
            </div>
            <div className="text-center">
                <p className="font-bold text-sm">{title}</p>
                <p className="text-[10px] text-white/40 mt-1 uppercase tracking-widest font-black">
                    {file ? (file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name) : 'Drag & Drop MP4'}
                </p>
            </div>
        </div>
    );

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={!isProcessing ? onClose : undefined}
                    className="absolute inset-0 bg-black/60 backdrop-blur-md"
                />

                {/* Modal */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl glass-card rounded-[40px] border border-white/10 overflow-hidden shadow-2xl p-8"
                >
                    {/* Close button */}
                    {!isProcessing && (
                        <button
                            onClick={onClose}
                            className="absolute top-6 right-6 p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    )}

                    <div className="text-center mb-8">
                        <div className="w-16 h-16 mx-auto bg-primary/20 rounded-full flex items-center justify-center mb-4">
                            <UploadCloud className="w-8 h-8 text-primary" />
                        </div>
                        <h2 className="text-3xl font-black tracking-tight">Process Videos</h2>
                        <p className="text-white/40 text-sm mt-2 max-w-sm mx-auto">
                            Upload footage from the Inside and Outside cameras to compute the exact attendance percentage for all students.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-6 mb-8">
                        <UploadBox
                            title="Inside Camera"
                            file={insideFile}
                            setFile={setInsideFile}
                            type="INSIDE"
                        />
                        <UploadBox
                            title="Outside Camera"
                            file={outsideFile}
                            setFile={setOutsideFile}
                            type="OUTSIDE"
                        />
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex gap-3 mb-8">
                        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                        <p className="text-xs text-amber-500/80 leading-relaxed">
                            Ensure both videos cover roughly the same timeframe of the lecture. The Python engine will track
                            entry and exit chronological matching. Processing may take a few minutes based on video length.
                        </p>
                    </div>

                    <button
                        onClick={handleProcess}
                        disabled={isProcessing || !insideFile || !outsideFile}
                        className="w-full btn-primary py-5 rounded-[24px] text-sm uppercase tracking-widest font-black disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
                    >
                        {isProcessing ? (
                            <span className="flex items-center justify-center gap-3">
                                <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                                Processing...
                            </span>
                        ) : (
                            'Run Attendance Analyzer'
                        )}
                    </button>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
