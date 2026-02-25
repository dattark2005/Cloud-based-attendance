'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { LogOut, Bell, Menu, X, ShieldCheck, LayoutDashboard, Clock, Users, UserCircle, Navigation } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchWithAuth } from '@/lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    async function getUser() {
      try {
        const storedToken = localStorage.getItem('token');
        if (!storedToken) {
          router.push('/login');
          return;
        }
        const res = await fetchWithAuth('/auth/me');
        setUser(res.data.user);
      } catch (err) {
        console.error(err);
        localStorage.removeItem('token');
        router.push('/login');
      }
    }
    getUser();
  }, [router, pathname]);

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
    toast.success('Logged out');
  };

  const navItems = user?.role === 'TEACHER' ? [
    { icon: <LayoutDashboard />, label: 'Overview', href: '/teacher/dashboard' },
    { icon: <Clock />, label: 'Live Attendance', href: '/teacher/attendance' },
    { icon: <Navigation />, label: 'GPS Attendance', href: '/teacher/gps-attendance' },
    { icon: <Users />, label: 'Student Logs', href: '/teacher/logs' },
    { icon: <UserCircle />, label: 'Profile & Settings', href: '/teacher/profile' },
  ] : [
    { icon: <LayoutDashboard />, label: 'My Stats', href: '/student/dashboard' },
    { icon: <Clock />, label: 'Attendance History', href: '/student/history' },
    { icon: <UserCircle />, label: 'Profile & Settings', href: '/student/profile' },
  ];

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 80 }}
        className="glass-card border-r border-white/5 h-screen sticky top-0 z-50 flex flex-col pt-8"
      >
        <div className="px-6 mb-12 flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shrink-0">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          {isSidebarOpen && (
            <span className="font-bold text-xl tracking-tighter">SECURE.IO</span>
          )}
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item, idx) => (
            <button
              key={idx}
              onClick={() => router.push(item.href)}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${pathname === item.href ? 'bg-primary text-white' : 'text-white/40 hover:bg-white/5'
                }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {isSidebarOpen && <span className="ml-4 font-medium">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button
            onClick={handleLogout}
            className="w-full flex items-center p-3 rounded-xl text-accent hover:bg-accent/10 transition-all"
          >
            <LogOut className="shrink-0" />
            {isSidebarOpen && <span className="ml-4 font-medium">Log out</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 relative">
        <header className="flex justify-between items-center mb-12">
          <div>
            <h2 className="text-white/40 text-sm font-medium">Welcome back,</h2>
            <h1 className="text-3xl font-bold">{user?.fullName}</h1>
          </div>
          <div className="flex items-center space-x-4">
            <button className="p-3 rounded-xl bg-white/5 border border-white/5 relative">
              <Bell className="w-5 h-5" />
              <div className="absolute top-3 right-3 w-2 h-2 bg-accent rounded-full border-2 border-background"></div>
            </button>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-primary to-secondary p-[1px]">
              <div className="w-full h-full bg-background rounded-[11px] flex items-center justify-center font-bold">
                {user?.fullName?.charAt(0)}
              </div>
            </div>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
