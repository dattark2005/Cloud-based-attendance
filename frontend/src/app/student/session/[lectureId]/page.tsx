'use client';
// This page is no longer used — attendance is marked by teachers only.
// Students are redirected to the classroom detail page.
import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function StudentSessionRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/student/dashboard'); }, [router]);
  return null;
}
