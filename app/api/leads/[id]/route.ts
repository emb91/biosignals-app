import { NextResponse } from 'next/server';
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
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

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

    return NextResponse.json({ data });
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

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in leads/[id] PUT:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('user_id', user.id)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('Error in leads/[id] DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
