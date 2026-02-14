'use client';

import { Toaster } from 'react-hot-toast';
import { SessionProvider } from '@/providers/SessionProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Toaster 
        position="top-right"
        toastOptions={{
          className: 'glass-card text-white border-white/10',
          style: {
            background: 'rgba(20, 20, 20, 0.8)',
            backdropFilter: 'blur(10px)',
            color: '#fff',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }}
      />
      {children}
    </SessionProvider>
  );
}
