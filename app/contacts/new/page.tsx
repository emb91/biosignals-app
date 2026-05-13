'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

/** Legacy URL: buying teams are edited on each ICP card (`/icps`). */
export default function ContactNewRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(ROUTES.setup.icps);
  }, [router]);

  return null;
}
