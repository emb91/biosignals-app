'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

export default function SignalsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(ROUTES.contactSignals);
  }, [router]);

  return null;
}
