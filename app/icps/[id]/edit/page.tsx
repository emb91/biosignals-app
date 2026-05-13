import { redirect } from 'next/navigation';

// Editing is now done inline on the ICP criteria page.
export default function ICPEditRedirect() {
  redirect('/icps');
}
