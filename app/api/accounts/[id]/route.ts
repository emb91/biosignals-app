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

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date().toISOString();

    const { error: companyError } = await supabase
      .from('companies')
      .update({
        archived_at: now,
        archived_by: user.id,
        archived_reason: 'user_archived',
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('id', id)
      .is('archived_at', null);

    if (companyError) {
      return NextResponse.json({ error: companyError.message }, { status: 500 });
    }

    const { error: contactError } = await supabase
      .from('contacts')
      .update({
        archived_at: now,
        archived_by: user.id,
        archived_reason: 'company_archived',
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('company_id', id)
      .is('archived_at', null);

    if (contactError) {
      return NextResponse.json({ error: contactError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id, archived: true });
  } catch (error) {
    console.error('Error in accounts/[id] DELETE:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
