'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, RefreshCw, CheckCircle2, AlertCircle, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface VoiceRecorderProps {
  onRecord: (audioBase64: string) => void;
  sentence?: string;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onRecord, sentence }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      chunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = async () => {
        const blob = new Blob(chunks.current, { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          setAudioBase64(base64data);
        };
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const reset = () => {
    setAudioUrl(null);
    setAudioBase64(null);
    setDuration(0);
  };

  const confirm = () => {
    if (audioBase64) {
      onRecord(audioBase64);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto space-y-6">
      {sentence && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full p-6 glass-card rounded-3xl border-2 border-primary/20 text-center space-y-3"
        >
          <p className="text-xs uppercase tracking-widest text-primary font-bold">Please say precisely:</p>
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-secondary to-accent leading-tight italic">
            "{sentence}"
          </h2>
        </motion.div>
      )}

      <div className="relative flex flex-col items-center space-y-6 w-full">
        <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${isRecording ? 'bg-accent/20 scale-110 shadow-[0_0_50px_rgba(244,63,94,0.3)]' : 'bg-white/5 border border-white/10'}`}>
          <AnimatePresence mode='wait'>
            {isRecording ? (
              <motion.div
                key="stop"
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                onClick={stopRecording}
                className="w-20 h-20 bg-accent rounded-full flex items-center justify-center cursor-pointer shadow-lg active:scale-90 transition-transform"
              >
                <Square className="w-8 h-8 text-white fill-white" />
              </motion.div>
            ) : !audioUrl ? (
              <motion.div
                key="mic"
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                onClick={startRecording}
                className="w-20 h-20 bg-primary rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:bg-primary/80 active:scale-90 transition-all"
              >
                <Mic className="w-8 h-8 text-white" />
              </motion.div>
            ) : (
              <motion.div
                key="play"
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg"
              >
                <Volume2 className="w-8 h-8 text-white" />
              </motion.div>
            )}
          </AnimatePresence>
          
          {isRecording && (
            <div className="absolute inset-0 rounded-full border-2 border-accent animate-ping opacity-20 pointer-events-none"></div>
          )}
        </div>

        {isRecording && (
          <div className="flex flex-col items-center space-y-2">
            <div className="flex space-x-1">
              {[1,2,3,4,5].map(i => (
                <motion.div 
                  key={i}
                  animate={{ height: [10, 30, 10] }}
                  transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                  className="w-1 bg-accent rounded-full"
                />
              ))}
            </div>
            <span className="text-accent font-mono font-bold tracking-tighter">
              00:{duration.toString().padStart(2, '0')}
            </span>
          </div>
        )}

        {audioUrl && !isRecording && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full space-y-4"
          >
            <div className="flex justify-center space-x-4">
              <button 
                onClick={reset}
                className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition-all text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Rerecord</span>
              </button>
            </div>
            <button 
              onClick={confirm}
              className="w-full btn-primary flex items-center justify-center space-x-2 py-4"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>Verify Voice</span>
            </button>
          </motion.div>
        )}
      </div>

      <div className="text-center">
        <p className="text-sm text-white/50">
          {isRecording ? "Listening..." : audioUrl ? "Voice captured" : "Tap to start recording"}
        </p>
      </div>
    </div>
  );
};

export default VoiceRecorder;
