/**
 * POST /api/outreach/sequence
 *
 * Generates a 7-message outreach sequence anchored to a chosen hook.
 * Day offsets: 0 (initial) → 3, 7, 11, 15, 21, 28 (six follow-ups).
 *
 * Does NOT persist — returns the messages so the rep can edit them in the
 * UI before deciding to export. Persistence happens at /api/outreach/export.
 *
 * Input:  { contactId, anchorHookText, anchorSignalEventId? }
 * Output: { messages: Array<{ day_offset, subject, body }> }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

const DAY_OFFSETS = [0, 3, 7, 11, 15, 21, 28] as const;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Internal server error';
}

type Message = {
  day_offset: number;
  subject: string;
  body: string;
};

function tolerantJsonParse(text: string): unknown {
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1].trim();
  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  if (objStart === -1 || objEnd === -1) return null;
  try {
    return JSON.parse(candidate.slice(objStart, objEnd + 1));
  } catch {
    return null;
  }
}

function parseSequence(text: string): Message[] {
  const parsed = tolerantJsonParse(text);
  if (!parsed || typeof parsed !== 'object') return [];
  const raw = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m, i): Message | null => {
      if (!m || typeof m !== 'object') return null;
      const o = m as Record<string, unknown>;
      const dayOffset = typeof o.day_offset === 'number' && Number.isFinite(o.day_offset)
        ? Math.floor(o.day_offset)
        : DAY_OFFSETS[i] ?? i * 4;
      const subject = typeof o.subject === 'string' ? o.subject.trim() : '';
      const body = typeof o.body === 'string' ? o.body.trim() : '';
      if (!subject || !body) return null;
      return { day_offset: dayOffset, subject, body };
    })
    .filter((v): v is Message => v !== null)
    .slice(0, 7);
}

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

    const body = (await request.json().catch(() => ({}))) as {
      contactId?: unknown;
      anchorHookText?: unknown;
      anchorSignalEventId?: unknown;
      anchorSignalType?: unknown;
    };
    const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
    const anchorHookText = typeof body.anchorHookText === 'string' ? body.anchorHookText.trim() : '';
    const anchorSignalType = typeof body.anchorSignalType === 'string' ? body.anchorSignalType.trim() : null;
    if (!contactId || !anchorHookText) {
      return NextResponse.json({ error: 'contactId and anchorHookText required' }, { status: 400 });
    }

    // Reload the same context as /hooks so the sequence is grounded in
    // the actual data (not just whatever the hook text says).
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select(
        'id, full_name, first_name, job_title, seniority_level, business_area, contact_bio, contact_panel_summary, contact_fit_summary, resolved_current_company_name, resolved_employment_history, company_id, company_name, companies(id, company_name, domain, description, bio_summary, industry, employee_range, founded_year, headquarters_city, headquarters_country, company_type, funding_stage, therapeutic_areas, modalities, development_stages, products_services, services, technologies)'
      )
      .eq('user_id', user.id)
      .eq('id', contactId)
      .maybeSingle();
    if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const { data: selfCompany } = await supabase
      .from('user_company')
      .select(
        'company_name, tagline, description, products_services, value_propositions, differentiated_value, capabilities, challenges_addressed, customer_benefits, customers_we_serve, why_customers_buy'
      )
      .eq('user_id', user.id)
      .maybeSingle();

    const prompt = buildPrompt({
      contact: contact as Record<string, unknown>,
      selfCompany: (selfCompany ?? null) as Record<string, unknown> | null,
      anchorHookText,
      anchorSignalType,
    });

    const completion = await completeLlm({
      feature: 'outreach_sequence',
      prompt,
      maxTokens: 3500,
      temperature: 0.4,
    });
    await recordLlmUsageEvent({
      provider: completion.provider,
      feature: 'outreach_sequence',
      route: 'app/api/outreach/sequence',
      model: completion.model,
      usage: completion.usage,
      metadata: { contact_id: contactId, hook: anchorHookText.slice(0, 120) },
    });

    const messages = parseSequence(completion.text);
    if (messages.length < 5) {
      // Sanity check — if Sonnet returned fewer than 5 messages something
      // went wrong with the parse or the prompt. 5+ is acceptable, 7 ideal.
      return NextResponse.json({ error: 'Generated sequence too short', count: messages.length }, { status: 502 });
    }

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Error in outreach/sequence POST:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

function buildPrompt(opts: {
  contact: Record<string, unknown>;
  selfCompany: Record<string, unknown> | null;
  anchorHookText: string;
}): string {
  const contactCo = (opts.contact.companies ?? null) as Record<string, unknown> | Array<Record<string, unknown>> | null;
  const co = Array.isArray(contactCo) ? contactCo[0] : contactCo;
  const firstName = (opts.contact.first_name as string | null) ?? '';
  const fullName = (opts.contact.full_name as string | null) ?? '';

  const contextBlock = JSON.stringify(
    {
      contact: {
        name: fullName,
        first_name: firstName,
        title: opts.contact.job_title,
        seniority: opts.contact.seniority_level,
        business_area: opts.contact.business_area,
        bio: opts.contact.contact_bio,
        fit_summary: opts.contact.contact_fit_summary,
      },
      company: co
        ? {
            name: co.company_name,
            description: co.description,
            bio: co.bio_summary,
            industry: co.industry,
            employee_range: co.employee_range,
            funding_stage: co.funding_stage,
            therapeutic_areas: co.therapeutic_areas,
            modalities: co.modalities,
            development_stages: co.development_stages,
            products_services: co.products_services,
            services: co.services,
            technologies: co.technologies,
          }
        : null,
      our_company: opts.selfCompany
        ? {
            name: opts.selfCompany.company_name,
            tagline: opts.selfCompany.tagline,
            description: opts.selfCompany.description,
            products_services: opts.selfCompany.products_services,
            value_propositions: opts.selfCompany.value_propositions,
            differentiated_value: opts.selfCompany.differentiated_value,
            capabilities: opts.selfCompany.capabilities,
            challenges_addressed: opts.selfCompany.challenges_addressed,
            customer_benefits: opts.selfCompany.customer_benefits,
            customers_we_serve: opts.selfCompany.customers_we_serve,
            why_customers_buy: opts.selfCompany.why_customers_buy,
          }
        : null,
    },
    null,
    2,
  );

  return `You are writing a 7-message outreach sequence for a sales rep. The whole sequence anchors on ONE hook (the opener below). Each subsequent message references the same hook implicitly or revisits it from a different angle — but does not just paraphrase.

ANCHOR HOOK (use this as the opener of message 1):
"${opts.anchorHookText}"

CADENCE — 7 messages, fixed day offsets:
- Day 0: Initial. Lead with the hook. End with a soft, low-friction ask (15 min, a question, a relevant link).
- Day 3: Quick bump. 1-2 sentences. Re-surface the same thread.
- Day 7: New angle on the same anchor. Add a piece of value (insight, observation, pattern from similar companies).
- Day 11: Social proof or comparative ("we worked with X who had a similar profile…"). Only invent companies if our_company.customers_we_serve lists them.
- Day 15: Pattern interrupt. Short, slightly informal. Reframe — "totally understand if not a fit, just wanted to make sure you saw…"
- Day 21: Final value drop. A short observation or insight tied to their stage/space. Don't pitch.
- Day 28: Breakup. One short paragraph. "Closing the loop — happy to reconnect when the timing's right." Don't sound bitter.

CONSTRAINTS:
- First name only (${firstName}). Never use "Hi [Full Name]".
- Vary subject lines. No two should be the same wording. Subject lines should be short (3-7 words), lowercased except proper nouns, conversational.
- Body length: Day 0 = 60-100 words. Days 3, 15, 28 = 30-50 words. Days 7, 11, 21 = 60-90 words.
- No corporate jargon. No "I hope this finds you well." No "Just circling back."
- Don't repeat the same value proposition in every message — vary which capability/benefit/value you reference.
- If a fact isn't in the CONTEXT below, don't invent it.

CONTEXT:
${contextBlock}

OUTPUT — strict JSON, no prose, no markdown fences:
{
  "messages": [
    { "day_offset": 0,  "subject": "...", "body": "..." },
    { "day_offset": 3,  "subject": "...", "body": "..." },
    { "day_offset": 7,  "subject": "...", "body": "..." },
    { "day_offset": 11, "subject": "...", "body": "..." },
    { "day_offset": 15, "subject": "...", "body": "..." },
    { "day_offset": 21, "subject": "...", "body": "..." },
    { "day_offset": 28, "subject": "...", "body": "..." }
  ]
}`;
}
