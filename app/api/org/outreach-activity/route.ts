/**
 * POST /api/org/outreach-activity  body { contactIds: string[] }
 *
 * For a set of the caller's contacts, returns which ones a TEAMMATE is already working:
 * { byContactId: { [contactId]: { userName, status, customerFacing } } }
 *
 * Used by the contacts list/action cell ("In sequence with Alice"), the side panel
 * ("Assigned to Alice" once customer-facing), and anywhere recommendations need to steer
 * reps away from leads a teammate is on. Capped to keep the lookup cheap.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { fetchOrgOutreachActivityByContact } from '@/lib/org-outreach';

const MAX_IDS = 500;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { contactIds?: unknown } | null;
  const contactIds = Array.isArray(body?.contactIds)
    ? (body!.contactIds.filter((v) => typeof v === 'string') as string[]).slice(0, MAX_IDS)
    : [];
  if (contactIds.length === 0) return NextResponse.json({ byContactId: {} });

  const activity = await fetchOrgOutreachActivityByContact(supabase, {
    userId: user.id,
    contactIds,
  });

  const byContactId: Record<string, { userName: string; status: string; customerFacing: boolean }> = {};
  for (const [contactId, a] of activity) {
    byContactId[contactId] = {
      userName: a.userName,
      status: a.status,
      customerFacing: a.customerFacing,
    };
  }
  return NextResponse.json({ byContactId });
}
