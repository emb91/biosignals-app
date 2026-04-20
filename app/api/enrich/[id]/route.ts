import { NextResponse } from 'next/server';
import { runContactResolutionPipelineForContact } from '@/lib/contact-resolution-pipeline';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

export async function POST(
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

    const admin = createAdminClient();
    const result = await runContactResolutionPipelineForContact(
      admin as unknown as Parameters<typeof runContactResolutionPipelineForContact>[0],
      {
        contactId: id,
        userId: user.id,
      }
    );

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('Error in enrich POST:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
