import { redirect } from 'next/navigation';

/** Legacy path: pipeline health now lives at `/health`. */
export default function PipelineRedirectPage() {
  redirect('/health');
}
