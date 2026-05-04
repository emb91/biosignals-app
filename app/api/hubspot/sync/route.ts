import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase-server';
import { getValidAccessToken, fetchHubSpotContacts } from '@/lib/hubspot';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(user.id, supabase);
  } catch {
    return NextResponse.json({ error: 'HubSpot not connected' }, { status: 400 });
  }

  const contacts = await fetchHubSpotContacts(accessToken);

  const headers = [
    'first_name',
    'last_name',
    'email_address',
    'job_title',
    'company_name',
    'company_domain',
    'linkedin_url',
    'location',
  ];

  const rows = contacts.map((c) => {
    const p = c.properties;
    const location = [p.city, p.country].filter(Boolean).join(', ');
    return [
      p.firstname ?? '',
      p.lastname ?? '',
      p.email ?? '',
      p.jobtitle ?? '',
      p.company ?? '',
      p.website ?? '',
      p.hs_linkedin_url ?? '',
      location,
    ];
  });

  const columnMappings = Object.fromEntries(headers.map((h) => [h, h]));
  const filename = `hubspot-sync-${new Date().toISOString().slice(0, 10)}.csv`;

  const cookieStore = await cookies();
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/import-contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieStore.toString(),
    },
    body: JSON.stringify({ headers, rows, columnMappings, filename }),
  });

  const result = await res.json();
  return NextResponse.json({ ok: true, batchId: result.batchId, total: contacts.length });
}
