import { NextResponse } from 'next/server';
import {
  fetchContactEmailsForContacts,
  looksLikeEmail,
  normalizeUserEmailDeliverability,
  syncEmailDeliverabilityOverrides,
  syncUserAddedContactEmails,
  syncPrimaryEmailAsUserRowIfNeeded,
  type EmailDeliverabilityOverride,
} from '@/lib/contact-emails';
import {
  fetchContactPhonesForContacts,
  looksLikePhone,
  syncUserAddedContactPhones,
} from '@/lib/contact-phones';
import { createClient } from '@/lib/supabase-server';

type LeadUpdateBody = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  headline?: string;
  email?: string;
  linkedin_url?: string;
  company_name?: string;
  company_domain?: string;
  company_linkedin_url?: string;
  location?: string;
  city?: string;
  country?: string;
  /** Secondary addresses with category `user` (primary `email` is separate). */
  user_secondary_emails?: unknown;
  /** Phones with category `user` — manual entry block on the contact panel. */
  user_phones?: unknown;
  /** Manual deliverability overrides keyed by email address. */
  email_deliverability_overrides?: unknown;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.details === 'string' && o.details) return o.details;
    if (typeof o.hint === 'string' && o.hint) return o.hint;
  }
  return 'Internal server error';
}

const splitFullName = (fullName: string | null): { first: string | null; last: string | null } => {
  if (!fullName) return { first: null, last: null };

  const tokens = fullName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: null, last: null };
  if (tokens.length === 1) return { first: tokens[0], last: null };

  return {
    first: tokens[0],
    last: tokens.slice(1).join(' '),
  };
};

export async function GET(
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

    // Full lead detail for the side panel + agent context. Includes the
    // complete companies(...) nested data (firmographics, products, funding,
    // criteria) that the lean list response omits.
    const { data, error } = await supabase
      .from('contacts')
      .select(
        // Note: matched_icp_id + company_fit_score moved to user_companies in
        // Phase 1d; not selectable on the canonical companies row.
        'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, headline, email, email_status, email_deliverability, linkedin_url, profile_photo_url, profile_photo_cached, company_name, company_domain, company_linkedin_url, location, city, country, contact_bio, contact_panel_summary, contact_fit_summary, fit_score, readiness_score, overall_fit_score, contact_fit_score, priority_score, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, enrichment_refresh_status, enrichment_refresh_finished_at, profile_enrichment_status, profile_enrichment_completed_at, linkedin_resolution_status, source, created_at, updated_at, company_id, companies(id, company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, sub_industry, employee_count, employee_range, company_size_bucket, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties, products_services, services, technologies, company_type, company_type_display, platform_category, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_summary, therapeutic_areas, modalities, development_stages, clinical_stage, last_enriched_at)'
      )
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    try {
      const [emailsGrouped, phonesGrouped] = await Promise.all([
        fetchContactEmailsForContacts(supabase, [id]),
        fetchContactPhonesForContacts(supabase, [id]),
      ]);
      return NextResponse.json({
        data: {
          ...data,
          contact_emails: emailsGrouped.get(id) ?? [],
          contact_phones: phonesGrouped.get(id) ?? [],
        },
      });
    } catch {
      return NextResponse.json({
        data: { ...data, contact_emails: [], contact_phones: [] },
      });
    }
  } catch (error) {
    console.error('Error in leads/[id] GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
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

    const body = (await request.json()) as LeadUpdateBody;
    const fullName = normalizeString(body.full_name);
    const firstName = normalizeString(body.first_name);
    const lastName = normalizeString(body.last_name);
    const primaryEmailNorm = normalizeString(body.email)?.toLowerCase() ?? '';

    const userSecondaryEmails = Array.isArray(body.user_secondary_emails)
      ? (body.user_secondary_emails.filter((item) => typeof item === 'string') as string[])
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.toLowerCase() !== primaryEmailNorm)
      : [];

    const userPhones = Array.isArray(body.user_phones)
      ? (body.user_phones.filter((item) => typeof item === 'string') as string[])
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];

    const primaryEmailRaw = normalizeString(body.email);
    if (primaryEmailRaw && !looksLikeEmail(primaryEmailRaw)) {
      return NextResponse.json(
        { error: 'Enter a valid email address (for example name@company.com).' },
        { status: 400 },
      );
    }

    for (const s of userSecondaryEmails) {
      if (!looksLikeEmail(s)) {
        return NextResponse.json(
          { error: 'Each additional email must look like a valid address.' },
          { status: 400 },
        );
      }
    }

    for (const p of userPhones) {
      if (!looksLikePhone(p)) {
        return NextResponse.json(
          { error: 'Each phone must look like a valid number.' },
          { status: 400 },
        );
      }
    }

    const derivedNames = !firstName && !lastName ? splitFullName(fullName) : { first: firstName, last: lastName };

    const updatePayload = {
      full_name: fullName,
      first_name: derivedNames.first,
      last_name: derivedNames.last,
      job_title: normalizeString(body.job_title),
      headline: normalizeString(body.headline),
      email: normalizeString(body.email),
      linkedin_url: normalizeString(body.linkedin_url),
      company_name: normalizeString(body.company_name),
      company_domain: normalizeString(body.company_domain)?.toLowerCase() || null,
      company_linkedin_url: normalizeString(body.company_linkedin_url),
      location: normalizeString(body.location),
      city: normalizeString(body.city),
      country: normalizeString(body.country),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('contacts')
      .update(updatePayload)
      .eq('user_id', user.id)
      .eq('id', id)
      .select(
        'id, full_name, first_name, last_name, job_title, headline, email, linkedin_url, company_name, company_domain, company_linkedin_url, location, city, country, updated_at, created_at'
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    try {
      await syncUserAddedContactEmails(supabase, {
        contactId: id,
        userId: user.id,
        additionalEmails: userSecondaryEmails,
      });
    } catch (emailErr) {
      console.error('syncUserAddedContactEmails failed:', emailErr);
      return NextResponse.json(
        { error: `Could not save additional emails: ${messageFromUnknown(emailErr)}` },
        { status: 500 },
      );
    }

    try {
      await syncUserAddedContactPhones(supabase, {
        contactId: id,
        userId: user.id,
        additionalPhones: userPhones,
      });
    } catch (phoneErr) {
      console.error('syncUserAddedContactPhones failed:', phoneErr);
      return NextResponse.json(
        { error: `Could not save phones: ${messageFromUnknown(phoneErr)}` },
        { status: 500 },
      );
    }

    try {
      await syncPrimaryEmailAsUserRowIfNeeded(supabase, {
        contactId: id,
        userId: user.id,
        primaryEmail: normalizeString(body.email),
      });
    } catch (syncErr) {
      console.error('syncPrimaryEmailAsUserRowIfNeeded failed:', syncErr);
      return NextResponse.json(
        { error: `Could not sync primary email: ${messageFromUnknown(syncErr)}` },
        { status: 500 },
      );
    }

    const emailDeliverabilityOverrides: EmailDeliverabilityOverride[] = [];
    if (Array.isArray(body.email_deliverability_overrides)) {
      for (const item of body.email_deliverability_overrides) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const email = normalizeString(row.email);
        if (!email || !looksLikeEmail(email)) continue;
        if (!('email_deliverability' in row)) continue;
        const deliverability =
          row.email_deliverability == null || row.email_deliverability === ''
            ? null
            : normalizeUserEmailDeliverability(row.email_deliverability);
        if (row.email_deliverability != null && row.email_deliverability !== '' && deliverability == null) {
          return NextResponse.json(
            { error: 'Each email status override must be a supported deliverability value.' },
            { status: 400 },
          );
        }
        emailDeliverabilityOverrides.push({ email, email_deliverability: deliverability });
      }
    }

    try {
      await syncEmailDeliverabilityOverrides(supabase, {
        contactId: id,
        userId: user.id,
        primaryEmail: normalizeString(body.email),
        overrides: emailDeliverabilityOverrides,
      });
    } catch (deliverabilityErr) {
      console.error('syncEmailDeliverabilityOverrides failed:', deliverabilityErr);
      return NextResponse.json(
        { error: `Could not save email status overrides: ${messageFromUnknown(deliverabilityErr)}` },
        { status: 500 },
      );
    }

    try {
      const [emailsGrouped, phonesGrouped] = await Promise.all([
        fetchContactEmailsForContacts(supabase, [id]),
        fetchContactPhonesForContacts(supabase, [id]),
      ]);
      return NextResponse.json({
        data: {
          ...data,
          contact_emails: emailsGrouped.get(id) ?? [],
          contact_phones: phonesGrouped.get(id) ?? [],
        },
      });
    } catch {
      return NextResponse.json({
        data: { ...data, contact_emails: [], contact_phones: [] },
      });
    }
  } catch (error) {
    console.error('Error in leads/[id] PUT:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
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
    const { error } = await supabase
      .from('contacts')
      .update({
        archived_at: now,
        archived_by: user.id,
        archived_reason: 'user_archived',
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id, archived: true });
  } catch (error) {
    console.error('Error in leads/[id] DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
