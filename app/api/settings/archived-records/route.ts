import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.details === 'string' && o.details) return o.details;
  }
  return 'Internal server error';
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [accountsResult, contactsResult] = await Promise.all([
      supabase
        .from('accounts_view')
        .select('id, company_name, domain, archived_at, archived_reason')
        .eq('user_id', user.id)
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false }),
      supabase
        .from('contacts')
        .select('id, full_name, email, company_id, company_name, archived_at, archived_reason')
        .eq('user_id', user.id)
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false }),
    ]);

    if (accountsResult.error) {
      return NextResponse.json({ error: accountsResult.error.message }, { status: 500 });
    }
    if (contactsResult.error) {
      return NextResponse.json({ error: contactsResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      accounts: accountsResult.data ?? [],
      contacts: contactsResult.data ?? [],
    });
  } catch (error) {
    console.error('Error in settings/archived-records GET:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
