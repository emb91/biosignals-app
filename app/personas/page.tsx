'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PersonasRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/company-criteria');
  }, [router]);
  return null;
}
