import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

/** Legacy path: pipeline health now lives at `/leads/health`. */
export default function PipelineRedirectPage() {
  redirect(ROUTES.leads.health);
}
