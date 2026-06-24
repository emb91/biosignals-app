import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function clampTwoSentences(input: string, fallback: string): string {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  const parts = text.match(/[^.!?]+[.!?]?/g)?.map((p) => p.trim()).filter(Boolean) ?? [];
  if (parts.length === 0) return fallback;
  return parts.slice(0, 2).join(' ');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: leadId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: lead, error: leadError } = await supabase
      .from('contacts')
      .select(`
        id,
        full_name,
        first_name,
        last_name,
        job_title,
        seniority_level,
        business_area,
        company_id,
        company_name,
        fit_score,
        contact_fit_score,
        overall_fit_score,
        contact_panel_summary,
        contact_fit_summary
      `)
      .eq('user_id', user.id)
      .eq('id', leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const { data: company } = lead.company_id
      ? await supabase
          .from('companies')
          .select('company_name,company_type_display,funding_stage,therapeutic_areas,modalities')
          .eq('id', lead.company_id)
          .maybeSingle()
      : { data: null };

    const contactName =
      lead.full_name ||
      [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
      'This contact';
    const companyName = company?.company_name || lead.company_name || 'this company';

    const contactFallback = `${contactName} is tracked at ${companyName}. This profile updates when role, company, or CRM context changes.`;
    const fitFallback = `${contactName} is scored from company and contact fit against your ICP. Stronger overlap with your target profile raises fit confidence.`;

    return NextResponse.json({
      contactSummary: clampTwoSentences(
        typeof lead.contact_panel_summary === 'string' ? lead.contact_panel_summary : '',
        contactFallback,
      ),
      fitSummary: clampTwoSentences(
        typeof lead.contact_fit_summary === 'string' ? lead.contact_fit_summary : '',
        fitFallback,
      ),
    });
  } catch (error) {
    console.error('[GET /api/contacts/[id]/panel-summaries]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
