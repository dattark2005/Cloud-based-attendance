'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

export default function ActiveSessionRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sectionId = searchParams.get('sectionId');

  useEffect(() => {
    const findSession = async () => {
      try {
        const res = await fetchWithAuth('/sections/active');
        const session = res.data?.sessions.find((s: any) => 
          s.sectionId?._id === sectionId || s.sectionId === sectionId
        );
        if (session) {
          router.replace(`/teacher/session/${session._id}`);
        } else {
          toast.error('No active session found for this classroom');
          router.replace('/teacher/dashboard');
        }
      } catch (err) {
        toast.error('Failed to resolve session');
        router.replace('/teacher/dashboard');
      }
    };

    if (sectionId) {
      findSession();
    }
  }, [sectionId]);

  return <div className="min-h-screen bg-black flex items-center justify-center">
    <div className="text-center space-y-4">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-white/40 text-xs font-black uppercase tracking-widest">Resolving Live Session...</p>
    </div>
  </div>;
}
