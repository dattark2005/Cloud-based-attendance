'use client';

import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, RefreshCw, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CameraCaptureProps {
  onCapture: (image: string) => void;
  title?: string;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, title = "Capture Face" }) => {
  const webcamRef = useRef<Webcam>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setImgSrc(imageSrc);
    }
  }, [webcamRef]);

  const reset = () => {
    setImgSrc(null);
    setError(null);
  };

  const confirm = () => {
    if (imgSrc) {
      onCapture(imgSrc);
      setImgSrc(null); // Reset for next capture angle
    }
  };

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto space-y-4">
      <div className="relative w-full aspect-video rounded-3xl overflow-hidden glass-card border-2 border-white/10 group">
        {!imgSrc ? (
          <>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{ facingMode }}
              onUserMediaError={() => setError("Camera access denied")}
              className="w-full h-full object-cover"
            />
            {/* Face Oval Overlay */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-64 h-80 border-2 border-dashed border-white/40 rounded-[100%] animate-pulse-slow"></div>
            </div>
            
            <div className="absolute bottom-4 left-0 right-0 flex justify-center space-x-4 px-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={toggleCamera} className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 transition-all">
                <RefreshCw className="w-6 h-6 text-white" />
              </button>
              <button onClick={capture} className="p-4 rounded-full bg-primary hover:bg-primary-glow border border-white/20 transition-all shadow-lg scale-110">
                <Camera className="w-7 h-7 text-white" />
              </button>
            </div>
          </>
        ) : (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative w-full h-full"
          >
            <img src={imgSrc} alt="captured" className="w-full h-full object-cover" />
            <div className="absolute top-4 right-4">
              <button onClick={reset} className="p-2 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="absolute bottom-6 left-0 right-0 flex justify-center px-6">
              <button 
                onClick={confirm}
                className="w-full btn-primary flex items-center justify-center space-x-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>Verify Face</span>
              </button>
            </div>
          </motion.div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-accent" />
            <p className="text-white font-medium">{error}</p>
            <button onClick={() => window.location.reload()} className="btn-secondary text-sm">
              Try Again
            </button>
          </div>
        )}
      </div>
      
      <div className="text-center">
        <h3 className="text-lg font-semibold text-white/90">{title}</h3>
        <p className="text-sm text-white/50">Align your face within the oval guide</p>
      </div>
    </div>
  );
};

export default CameraCapture;
