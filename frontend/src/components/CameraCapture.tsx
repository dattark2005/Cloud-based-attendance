'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { Camera, RefreshCw, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CameraCaptureProps {
  onCapture: (image: string) => void;
  title?: string;
  resetTrigger?: number;
}

const VIDEO_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 },
};

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, title = "Capture Face", resetTrigger }) => {
  const webcamRef = useRef<Webcam>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset captured image when parent signals a new angle
  useEffect(() => {
    if (resetTrigger !== undefined) {
      setImgSrc(null);
      setError(null);
    }
  }, [resetTrigger]);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setImgSrc(imageSrc);
    }
  }, []);

  const reset = useCallback(() => {
    setImgSrc(null);
    setError(null);
  }, []);

  const confirm = useCallback(() => {
    if (imgSrc) {
      onCapture(imgSrc);
      setImgSrc(null);
    }
  }, [imgSrc, onCapture]);

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto space-y-4">
      <div className="relative w-full aspect-video rounded-3xl overflow-hidden glass-card border-2 border-white/10">
        {/* Webcam always mounted — hidden when captured image is shown */}
        <div style={{ display: imgSrc ? 'none' : 'block' }} className="w-full h-full">
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            screenshotQuality={0.92}
            forceScreenshotSourceSize
            videoConstraints={VIDEO_CONSTRAINTS}
            onUserMedia={() => setIsReady(true)}
            onUserMediaError={() => {
              setError("Camera access denied. Please allow camera permissions.");
              setIsReady(false);
            }}
            className="w-full h-full object-cover"
            mirrored
          />
          {/* Face oval guide — no animation to reduce flicker */}
          {isReady && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-52 h-64 border-2 border-dashed border-white/30 rounded-[100%]" />
            </div>
          )}
          {/* Capture button — always visible */}
          {isReady && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
              <button
                onClick={capture}
                className="p-4 rounded-full bg-blue-500 hover:bg-blue-400 border-2 border-white/30 transition-colors shadow-lg shadow-blue-500/30"
              >
                <Camera className="w-7 h-7 text-white" />
              </button>
            </div>
          )}
          {/* Loading indicator */}
          {!isReady && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Captured image preview */}
        {imgSrc && (
          <div className="relative w-full h-full">
            <img src={imgSrc} alt="captured" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-emerald-500/5 flex items-center justify-center">
              <div className="bg-emerald-500/20 rounded-full p-3 border-2 border-emerald-400/40">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
            </div>
            <button
              onClick={reset}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-amber-400" />
            <p className="text-white font-medium text-sm">{error}</p>
            <button onClick={() => window.location.reload()} className="btn-secondary text-sm">
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Confirm/Retake buttons */}
      {imgSrc ? (
        <div className="flex gap-3 w-full">
          <button onClick={reset} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-semibold text-sm transition-colors">
            Retake
          </button>
          <button onClick={confirm} className="flex-[2] btn-primary flex items-center justify-center space-x-2 py-3">
            <CheckCircle2 className="w-5 h-5" />
            <span>Confirm & Submit</span>
          </button>
        </div>
      ) : (
        <div className="text-center">
          <h3 className="text-lg font-semibold text-white/90">{title}</h3>
          <p className="text-sm text-white/50">Align your face within the oval guide</p>
        </div>
      )}
    </div>
  );
};

export default CameraCapture;
