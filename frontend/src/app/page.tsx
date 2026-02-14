'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ShieldCheck, Users, Clock, Zap, ArrowRight, Camera, Mic } from 'lucide-react';

export default function Home() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.2 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  const features = [
    {
      icon: <Camera className="w-6 h-6 text-primary" />,
      title: "Face Recognition",
      desc: "Instant identity verification for students via mobile camera."
    },
    {
      icon: <Mic className="w-6 h-6 text-secondary" />,
      title: "Anti-Deepfake Voice",
      desc: "Teacher authentication using dynamic sentence challenges."
    },
    {
      icon: <Clock className="w-6 h-6 text-accent" />,
      title: "Real-time Tracking",
      desc: "Monitor entry/exit times and total session duration automatically."
    }
  ];

  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-6 sm:p-24">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[120px] animate-pulse"></div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-5xl w-full z-10 text-center space-y-12"
      >
        <motion.div variants={itemVariants} className="space-y-4">
          <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full glass-card border-white/10 text-primary text-sm font-semibold mb-4">
            <Zap className="w-4 h-4 fill-primary" />
            <span>AI-Powered Attendance System</span>
          </div>
          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight leading-tight">
            Secure Attendance with <br />
            <span className="text-gradient">Biometric Intelligence</span>
          </h1>
          <p className="text-lg text-white/60 max-w-2xl mx-auto">
            A cloud-based solution for educational institutions. Eliminate proxy attendance using state-of-the-art face recognition and voice liveness detection.
          </p>
        </motion.div>

        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row justify-center items-center gap-6">
          <Link href="/login" className="w-full sm:w-auto">
            <button className="btn-primary w-full sm:px-12 flex items-center justify-center space-x-2 group">
              <span>Get Started</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>
          <Link href="/register" className="w-full sm:w-auto">
            <button className="btn-secondary w-full sm:px-12">
              Sign Up
            </button>
          </Link>
        </motion.div>

        <motion.div 
          variants={itemVariants}
          className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12"
        >
          {features.map((feature, i) => (
            <div key={i} className="glass-card p-8 rounded-3xl text-left hover:scale-[1.02] transition-all space-y-4">
              <div className="p-3 bg-white/5 rounded-2xl w-fit border border-white/5">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold">{feature.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">
                {feature.desc}
              </p>
            </div>
          ))}
        </motion.div>

        <motion.div variants={itemVariants} className="pt-24 border-t border-white/5">
          <div className="flex flex-wrap justify-center gap-12 opacity-40">
            <div className="flex items-center space-x-2 grayscale">
              <ShieldCheck className="w-6 h-6" />
              <span className="font-bold text-xl tracking-tighter">SECURE.AI</span>
            </div>
            <div className="flex items-center space-x-2 grayscale">
              <Users className="w-6 h-6" />
              <span className="font-bold text-xl tracking-tighter">CAMPUS.LOG</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </main>
  );
}
