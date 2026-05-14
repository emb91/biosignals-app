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

type RestoreBody = {
  type?: 'account' | 'contact';
  id?: string;
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as RestoreBody;
    if (!body.id || !body.type) {
      return NextResponse.json({ error: 'Type and id are required.' }, { status: 400 });
    }

    let companyIdToRestore: string | null = null;

    if (body.type === 'account') {
      companyIdToRestore = body.id;
    } else {
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('id, company_id')
        .eq('user_id', user.id)
        .eq('id', body.id)
        .maybeSingle();

      if (contactError) {
        return NextResponse.json({ error: contactError.message }, { status: 500 });
      }

      if (!contact) {
        return NextResponse.json({ error: 'Archived contact not found.' }, { status: 404 });
      }

      companyIdToRestore = (contact.company_id as string | null) ?? null;

      if (!companyIdToRestore) {
        const { error: singleRestoreError } = await supabase
          .from('contacts')
          .update({
            archived_at: null,
            archived_by: null,
            archived_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('id', body.id);

        if (singleRestoreError) {
          return NextResponse.json({ error: singleRestoreError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, restored: { type: 'contact', id: body.id } });
      }
    }

    const now = new Date().toISOString();

    const { error: companyError } = await supabase
      .from('companies')
      .update({
        archived_at: null,
        archived_by: null,
        archived_reason: null,
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('id', companyIdToRestore);

    if (companyError) {
      return NextResponse.json({ error: companyError.message }, { status: 500 });
    }

    const { error: contactsError } = await supabase
      .from('contacts')
      .update({
        archived_at: null,
        archived_by: null,
        archived_reason: null,
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('company_id', companyIdToRestore);

    if (contactsError) {
      return NextResponse.json({ error: contactsError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      restored: {
        type: 'account_group',
        companyId: companyIdToRestore,
      },
    });
  } catch (error) {
    console.error('Error in settings/archived-records/restore POST:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
