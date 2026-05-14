import { NextResponse } from 'next/server';
import {
  fetchContactEmailsForContacts,
  looksLikeEmail,
  syncUserAddedContactEmails,
  syncPrimaryEmailAsUserRowIfNeeded,
} from '@/lib/contact-emails';
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

    const { data, error } = await supabase
      .from('contacts')
      .select(
        'id, full_name, first_name, last_name, job_title, headline, email, linkedin_url, company_name, company_domain, company_linkedin_url, location, city, country, updated_at, created_at'
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
      const grouped = await fetchContactEmailsForContacts(supabase, [id]);
      return NextResponse.json({
        data: { ...data, contact_emails: grouped.get(id) ?? [] },
      });
    } catch {
      return NextResponse.json({
        data: { ...data, contact_emails: [] },
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

    try {
      const grouped = await fetchContactEmailsForContacts(supabase, [id]);
      return NextResponse.json({
        data: { ...data, contact_emails: grouped.get(id) ?? [] },
      });
    } catch {
      return NextResponse.json({
        data: { ...data, contact_emails: [] },
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
