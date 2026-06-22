import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const CRM_SOURCES = ['hubspot_crm_contacts', 'hubspot_crm_deals'] as const;

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

    const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('signal_source_events')
      .select(`
        id,
        entity_scope,
        entity_company_id,
        entity_contact_id,
        source,
        source_event_type,
        title,
        summary,
        event_at,
        observed_at,
        metadata,
        company:companies!signal_source_events_entity_company_id_fkey(
          company_name,
          domain
        ),
        contact:contacts!signal_source_events_entity_contact_id_fkey(
          full_name,
          email
        )
      `)
      .eq('user_id', user.id)
      .in('source', CRM_SOURCES)
      .gte('observed_at', cutoffIso)
      .order('observed_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[today/crm-activity] query failed', error);
      return NextResponse.json({ error: 'Failed to fetch CRM activity' }, { status: 500 });
    }

    const items = (data ?? []).map((row: any) => {
      const metadata = normalizeMetadata(row.metadata);
      const hubspotCompanyNames = Array.isArray(metadata.hubspot_company_names)
        ? metadata.hubspot_company_names.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];

      return {
        id: String(row.id),
        eventType: normalizeString(row.source_event_type) ?? 'crm_update',
        title: normalizeString(row.title),
        summary: normalizeString(row.summary),
        companyName:
          normalizeString(row.company?.company_name) ??
          normalizeString(metadata.arcova_company_name) ??
          hubspotCompanyNames[0] ??
          null,
        companyDomain: normalizeString(row.company?.domain) ?? normalizeString(metadata.arcova_company_domain),
        contactName: normalizeString(row.contact?.full_name),
        contactEmail: normalizeString(row.contact?.email),
        crmLabel: normalizeString(metadata.crm_label) ?? 'CRM',
        observedAt: normalizeString(row.observed_at) ?? new Date().toISOString(),
        eventAt: normalizeString(row.event_at),
      };
    });

    return NextResponse.json({ data: items });
  } catch (error) {
    console.error('[today/crm-activity] fatal', error);
    return NextResponse.json({ data: [] }, { status: 200 });
  }
}
