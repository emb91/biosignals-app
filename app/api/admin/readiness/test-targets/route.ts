import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';

export async function GET() {
  try {
    const auth = await createClient();
    const {
      data: { user },
      error: authError,
    } = await auth.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();

    const [companiesRes, contactsRes] = await Promise.all([
      admin
        .from('accounts_view')
        .select('id, company_name, domain')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(100),
      admin
        .from('contacts')
        .select('id, full_name, company_id, company_name, job_title')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(200),
    ]);

    if (companiesRes.error) {
      return NextResponse.json({ error: companiesRes.error.message }, { status: 500 });
    }
    if (contactsRes.error) {
      return NextResponse.json({ error: contactsRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      companies: companiesRes.data ?? [],
      contacts: contactsRes.data ?? [],
    });
  } catch (error) {
    console.error('[admin/readiness/test-targets] error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
