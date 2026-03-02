'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { socketService } from '@/lib/socket';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

interface SessionContextType {
  activeSessions: any[];
  refreshSessions: () => Promise<void>;
  loading: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSessions = async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetchWithAuth('/sections/active');
      if (res.success) {
        setActiveSessions(res.data.sessions);
      }
    } catch (err) {
      // Silently handle auth errors (e.g., expired token)
      console.warn('Failed to fetch active sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSessions();

    const socket = socketService.connect();

    socket.on('session:started', (data) => {
      const msg = data?.courseName ? `Session started: ${data.courseName}` : 'Session started!';
      toast.success(msg, {
        icon: '🚀',
        duration: 5000
      });
      refreshSessions();
    });

    socket.on('session:ended', () => {
      toast.dismiss();
      toast('Session ended', { icon: '🛑' });
      refreshSessions();
    });

    return () => {
      socketService.disconnect();
    };
  }, []);

  return (
    <SessionContext.Provider value={{ activeSessions, refreshSessions, loading }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
