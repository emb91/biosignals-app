/**
 * POST /api/outreach/sequence
 *
 * Generates a 7-message outreach sequence anchored to a chosen hook.
 * Day offsets: 0 (initial) → 3, 7, 11, 15, 21, 28 (six follow-ups).
 *
 * Does NOT persist — returns the messages so the rep can edit them in the
 * UI before deciding to stage. Persistence happens at /api/outreach/lemlist/stage.
 *
 * Input:  { contactId, anchorHookText, anchorSignalEventId? }
 * Output: { messages: Array<{ day_offset, subject, body }> }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { effectiveReadiness, getActionFromScores } from '@/lib/lead-action';
import { personaFunctionNames } from '@/lib/persona-functions';
import { fetchOutreachTone, renderToneBlock, type OutreachTone } from '@/lib/outreach-tone';

// Matches lemlist's default multichannel template — but the generator only
// writes COPY for the 6 message steps; the Day 7 LinkedIn invite is a pure
// action (no body needed) and gets injected by the stage endpoint as an
// empty marker, so we don't burn LLM tokens on copy nobody reads.
//
// Day 1  Email     — initial (LLM)
// Day 4  Email     — follow-up (LLM)
// Day 7  LinkedIn  — INVITE — injected by stage, no LLM copy
// Day 8  LinkedIn  — message (LLM, assumes invite accepted)
// Day 11 Email     — re-engage (LLM, lemlist's slot is voice; we use email)
// Day 14 LinkedIn  — message (LLM, final LI touch)
// Day 21 Email     — breakup (LLM)
const DAY_OFFSETS = [1, 4, 8, 11, 14, 21] as const;

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

// Deterministic safety net: strip punctuation/phrases the model keeps slipping
// in despite the prompt. Cheaper than re-running on every regression and means
// the rep doesn't see "—" or "circling back" in the editor.
/**
 * Force sentence case on a subject line: capitalize the first letter, keep
 * acronyms (>=2 consecutive uppercase letters) intact, lowercase every other
 * standalone capitalized word. This is a safety net — the prompt also tells
 * the model to use sentence case, but Sonnet defaults to Title Case for
 * subjects and the prompt instruction alone isn't reliable.
 *
 * "Quick Question About CMC Capacity" → "Quick question about CMC capacity"
 * "Following Up On BIOSECURE" → "Following up on BIOSECURE"
 */
function toSentenceCase(subject: string): string {
  if (!subject) return subject;
  // Word-level pass. A "word" is letters/digits with optional internal hyphens/apostrophes.
  const out = subject.replace(/[A-Za-z][\w'-]*/g, (word, offset: number) => {
    // Preserve all-caps acronyms (2+ uppercase letters in a row): CMC, BIOSECURE, VP, etc.
    const isAcronym = word.length >= 2 && word === word.toUpperCase() && /[A-Z]{2,}/.test(word);
    if (isAcronym) return word;
    // First word in the subject: capitalize the first letter, lowercase the rest.
    if (offset === 0) return word[0].toUpperCase() + word.slice(1).toLowerCase();
    // Everything else: lowercase.
    return word.toLowerCase();
  });
  return out;
}

function scrubAiTropes(text: string): string {
  if (!text) return text;
  let out = text;
  // Em dash / en dash → comma. Keeps the sentence breath without the AI tell.
  out = out.replace(/\s*[—–]\s*/g, ', ');
  // Common follow-up tropes — replace with neutral wording.
  out = out.replace(/\bjust circling back\b/gi, 'following up');
  out = out.replace(/\bcircling back\b/gi, 'following up');
  out = out.replace(/\bbumping this\b/gi, 'one more note');
  out = out.replace(/\bbumping this up\b/gi, 'one more note');
  out = out.replace(/\bhope (this|the email|my email) finds you well[,.]?\s*/gi, '');
  out = out.replace(/\bhope you'?re doing well[,.]?\s*/gi, '');
  // Collapse any double spaces or stray ", ," that the substitutions created.
  out = out.replace(/, ,/g, ',').replace(/[ \t]{2,}/g, ' ').replace(/\s+,/g, ',').trim();
  return out;
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
      const subject =
        typeof o.subject === 'string' ? toSentenceCase(scrubAiTropes(o.subject.trim())) : '';
      const body = typeof o.body === 'string' ? scrubAiTropes(o.body.trim()) : '';
      if (!subject || !body) return null;
      return { day_offset: dayOffset, subject, body };
    })
    .filter((v): v is Message => v !== null)
    .slice(0, 6);
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
      anchorIsContactLevel?: unknown;
    };
    const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
    const anchorHookText = typeof body.anchorHookText === 'string' ? body.anchorHookText.trim() : '';
    const anchorSignalType = typeof body.anchorSignalType === 'string' ? body.anchorSignalType.trim() : null;
    const anchorIsContactLevel = body.anchorIsContactLevel === true;
    if (!contactId || !anchorHookText) {
      return NextResponse.json({ error: 'contactId and anchorHookText required' }, { status: 400 });
    }

    // Reload the same context as /hooks so the sequence is grounded in
    // the actual data (not just whatever the hook text says).
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select(
        'id, full_name, first_name, job_title, seniority_level, business_area, contact_bio, contact_panel_summary, contact_fit_summary, contact_fit_score, readiness_score, resolved_current_company_name, resolved_employment_history, company_id, company_name, companies(id, company_name, domain, description, bio_summary, industry, employee_range, founded_year, headquarters_city, headquarters_country, company_type, funding_stage, therapeutic_areas, modalities, development_stages, products_services, services, technologies)'
      )
      .eq('user_id', user.id)
      .eq('id', contactId)
      .maybeSingle();
    if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    // Gate: a sequence may only be generated for a "reach out" contact (company
    // fit high AND contact fit high AND effective readiness high). This mirrors
    // the /hooks gate so a sequence can't be generated for a contact the picker
    // would never have surfaced (e.g. via a direct API call). Same source of
    // truth: lib/lead-action.getActionFromScores.
    let matchedIcpId: string | null = null;
    {
      const c = contact as {
        company_id?: string | null;
        contact_fit_score?: number | null;
        readiness_score?: number | null;
      };
      const contactFit = typeof c.contact_fit_score === 'number' ? c.contact_fit_score : null;
      const contactReadiness = typeof c.readiness_score === 'number' ? c.readiness_score : null;
      let companyFit: number | null = null;
      let companyReadiness: number | null = null;
      if (c.company_id) {
        const { data: uc } = await supabase
          .from('user_companies')
          .select('company_fit_score, readiness_score, matched_icp_id')
          .eq('user_id', user.id)
          .eq('company_id', c.company_id)
          .maybeSingle();
        if (uc) {
          const ucRow = uc as {
            company_fit_score?: number | null;
            readiness_score?: number | null;
            matched_icp_id?: string | null;
          };
          companyFit = typeof ucRow.company_fit_score === 'number' ? ucRow.company_fit_score : null;
          companyReadiness = typeof ucRow.readiness_score === 'number' ? ucRow.readiness_score : null;
          matchedIcpId = ucRow.matched_icp_id ?? null;
        }
      }
      const action = getActionFromScores(
        companyFit,
        contactFit,
        effectiveReadiness(companyReadiness, contactReadiness),
        null,
      );
      if (action !== 'reach_out') {
        return NextResponse.json(
          {
            error: 'Contact is not in the reach-out state — sequence generation is gated on fit + readiness.',
            action,
          },
          { status: 422 },
        );
      }
    }

    const { data: selfCompany } = await supabase
      .from('user_company')
      .select(
        'company_name, tagline, description, products_services, value_propositions, differentiated_value, capabilities, challenges_addressed, customer_benefits, customers_we_serve, why_customers_buy'
      )
      .eq('user_id', user.id)
      .maybeSingle();

    // Tone-of-voice settings (Settings → Outreach voice). Best-effort: null =>
    // no tone block, identical to prior behaviour.
    const tone = await fetchOutreachTone(supabase, user.id);

    // Buying group = the functions we sell into (inferred per ICP). Authoritative
    // ground truth for judging whether the anchor signal is relevant to the
    // people we target — not just to the company.
    let buyingGroupFunctions: string[] = [];
    if (matchedIcpId) {
      const { data: personas } = await supabase
        .from('personas')
        .select('functions')
        .eq('icp_id', matchedIcpId);
      const fnSet = new Set<string>();
      for (const p of (personas ?? []) as Array<{ functions?: unknown }>) {
        for (const f of personaFunctionNames(p.functions)) fnSet.add(f);
      }
      buyingGroupFunctions = [...fnSet];
    }

    const prompt = buildPrompt({
      contact: contact as Record<string, unknown>,
      selfCompany: (selfCompany ?? null) as Record<string, unknown> | null,
      anchorHookText,
      anchorSignalType,
      anchorIsContactLevel,
      buyingGroupFunctions,
      tone,
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
    if (messages.length < 4) {
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
  anchorSignalType: string | null;
  anchorIsContactLevel: boolean;
  buyingGroupFunctions: string[];
  tone: OutreachTone | null;
}): string {
  // Rendered tone block (empty string when the user hasn't set any). Injected
  // late in the prompt — after the generic VOICE rules + gold-standard example
  // — so recency weights the customer's stated voice above the defaults.
  const toneBlock = renderToneBlock(opts.tone);
  const contactCo = (opts.contact.companies ?? null) as Record<string, unknown> | Array<Record<string, unknown>> | null;
  const co = Array.isArray(contactCo) ? contactCo[0] : contactCo;
  const firstName = (opts.contact.first_name as string | null) ?? '';
  const fullName = (opts.contact.full_name as string | null) ?? '';
  const contactCompanyName = (co?.company_name as string | null) ?? (opts.contact.resolved_current_company_name as string | null) ?? (opts.contact.company_name as string | null) ?? '';
  const sellerName = (opts.selfCompany?.company_name as string | null) ?? 'OUR COMPANY';

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

  const signalScope = opts.anchorIsContactLevel ? 'CONTACT-LEVEL' : 'COMPANY-LEVEL';

  // Two very different framings depending on signal scope:
  //  • Contact-level (job change, promotion, new role): about ${firstName} personally — fine to reference directly.
  //  • Company-level (hiring, funding, patents, trials, M&A): about ${contactCompanyName}, which is ${firstName}'s own
  //    employer. ${firstName} already knows. Treat as TIMING context for the rep ("this is why I'm reaching out now"),
  //    not message body content ("did you know your company is hiring?"). The body should talk about ${firstName}'s
  //    function and what they need, not summarise their employer's news back at them.
  const buyingGroupHint = opts.buyingGroupFunctions.length
    ? `The functions you actually sell into (the buying group) are: ${opts.buyingGroupFunctions.join(', ')}. `
    : '';
  const scopeRules = opts.anchorIsContactLevel
    ? `The anchor signal is about ${firstName} personally (a role change, a paper they authored, etc.). You MAY reference it directly in message 1 as a brief, specific acknowledgment — warm, not sycophantic. It's still your TIMING, not an obligation: if a sharper opener exists, use that instead.`
    : `The anchor signal is about ${contactCompanyName || "the contact's employer"} — ${firstName}'s own company — so ${firstName} ALREADY KNOWS it. Apply TWO judgments before you use it:

  (1) RELEVANCE. ${buyingGroupHint}${firstName} is on the commercial / decision side, so they care about their company's TRAJECTORY — funding, approvals, expansion, hiring surges, new programs, deals, a wave of publications or patents all signal a company scaling or commercialising, which is a buying-relevant moment EVEN WHEN the signal originates in science, regulatory, clinical, or manufacturing. Do NOT discard the anchor just because it didn't come from ${firstName}'s own department. The only true noise is a trivial, isolated event in an unrelated function with no strategic read (e.g. a single HR hire). If the anchor genuinely doesn't connect to ${firstName}'s world, open on their role and the company's overall momentum instead.

  (2) THE SIGNAL IS YOUR TIMING, NOT AUTOMATICALLY YOUR OPENER. It's the private reason you're reaching out now; it does NOT have to appear in any message. Open with whatever genuinely lands for ${firstName} — usually their function and the problems that hit their desk. You MAY open on the signal ONLY when it reads as a natural, relevant observation AND you have nothing sharper to lead with. Some signals (e.g. a patent filing) rarely make a good opener; a relevant hiring surge can. Use common sense grounded in the company analysis. NEVER paraphrase ${firstName}'s own company news back at them as if it's a tip ("I saw ${contactCompanyName} is hiring", "noticed your team is expanding"). If you do reference the company moment, it works best later (around day 21) as a rep observation ("watching what ${contactCompanyName} is doing in X, customers in similar spots have found Y useful").`;

  return `You are a sales rep at ${sellerName} writing a 7-message outreach sequence to ${firstName} (${opts.contact.job_title ?? 'unknown title'}) at ${contactCompanyName || 'their company'}.

ANCHOR SIGNAL (${signalScope}${opts.anchorSignalType ? `, type: ${opts.anchorSignalType}` : ''}):
"${opts.anchorHookText}"

═══ STEP 1 — THINK BEFORE WRITING ═══
Do this reasoning silently, then use it to shape every message. Do not output the reasoning.

1. WHAT FUNCTION DOES ${firstName.toUpperCase()} WORK IN?
   Use the CONTEXT (title, seniority, business_area, bio). What do they own day-to-day? What are they measured on? What problems land on their desk vs. someone else's?

2. HOW DOES THE SIGNAL RELATE TO ${firstName.toUpperCase()}?
   ${scopeRules}

3. WHICH 2-3 ITEMS FROM our_company ACTUALLY MAP TO ${firstName.toUpperCase()}'S ROLE?
   Don't pick our most flattering value-prop. Pick the ones a person in this exact function would care about. Ignore the rest.

4. WHAT WOULD MAKE ${firstName.toUpperCase()} ROLL THEIR EYES?
   - Being told their own company's news as if it's a tip
   - Generic "I help companies like yours…" openers
   - A pitch in message 1
   - Anything that reads like AI wrote it

═══ STEP 2 — WRITE THE 7 MESSAGES ═══

SEQUENCE STRUCTURE — read carefully, it overrides anything you've been trained on:

(a) The anchor signal is your TIMING, not a required line. IF it passes the relevance test and makes a natural opener, reference it ONCE (in Day 1) and never again — returning to it ("as I mentioned re: your promotion…") reads as pestering. If it's not a good opener (e.g. a patent filing, or hiring unrelated to ${firstName}'s function), it is perfectly fine to never mention it — it was only ever your reason for timing, not the content.

(b) The PRODUCT is visible in EVERY message. This is NOT "don't pitch." The opposite. The whole point of outreach is to show what ${sellerName} does. But you show it by OFFERING SOMETHING CONCRETE the contact can have, never by describing features or asking for a meeting. Each message offers a tangible thing: a list, named companies, a data cut, a live view of their accounts. If a message doesn't offer something concrete, it's filler. Cut it.

(c) Lead with what we ALREADY HAVE (off-the-shelf), then layer custom on top. Our standard product (the buying signals we track + enriched contacts + CRM routing) is what wows. Custom signals are the layer that sits on top. Wow them with the off-the-shelf first.

═══ THE ARC ═══

Day 1 (email) → Day 4 (email) → [Day 7 LinkedIn INVITE — pure action, no copy] → Day 8 (LinkedIn message) → Day 11 (email) → Day 14 (LinkedIn message) → Day 21 (email)
hook + offer → specific data → [connect request action] → product reveal + offer → another data cut → honest nudge → always-on close

YOU WRITE COPY FOR EXACTLY 6 MESSAGES — Day 1, Day 4, Day 8, Day 11, Day 14, Day 21. The Day 7 LinkedIn connect request is a pure action step (lemlist sends the invite without a personalised note in our template), so DO NOT generate a Day 7 entry. Your messages[] output must contain exactly 6 entries in that order.

CHANNEL MIX NOTES (lemlist's default multichannel template):
- Day 8 is a LinkedIn MESSAGE — assume the invite was accepted. 50-80 words max. No subject (set to empty string).
- Day 14 is a LinkedIn MESSAGE — short, casual nudge. 30-50 words. No subject (set to empty string).
- Day 1, Day 4, Day 11, Day 21 are EMAIL and follow the word ranges below.

═══ PER-MESSAGE GUIDANCE ═══

- Day 1 (email, 80-110 words). Open like a human ("I wanted to reach out because…"). Lead with whatever is genuinely most relevant to ${firstName}'s world — that MAY be the anchor signal, but only if it passed the relevance + opener test above; otherwise open on their function and the problem someone in their exact role carries. ${opts.anchorIsContactLevel ? `For a personal signal a brief, direct acknowledgment is fine ("congrats on the new role").` : `Do NOT recap their employer's news back at them.`} Whatever you open on, state it NEUTRALLY — no editorialising or taking a stance, the contact may feel differently than you. Then ONE plain sentence on what ${sellerName} does (the honest one-liner from our_company, not a feature list). Then offer ONE concrete thing we can hand them, tailored to their world. End with "happy to share if of interest." NO presumptions about their situation you can't back up.

- Day 4 (email, 30-50 words). Offer a specific data cut we ALREADY track that fits their world. Use "several" or "a few" for counts, never a precise number you can't verify. End with "happy to share these with you if of interest."

- Day 8 (LinkedIn message, 50-80 words). Assume the invite was accepted. THE PRODUCT REVEAL. Explain plainly what ${sellerName} tracks as standard (the real signal types from our_company), how each is enriched with the decision-maker + contact, and that it routes into their CRM. Then the ONE thing that makes us different (pull from differentiated_value — e.g. life-sci-only, built by people who read the science). Close by offering to show them their own accounts live. No subject — set subject to empty string.

- Day 11 (email, 30-60 words). Another concrete data cut, different from Day 4's. Something tied to a specific strength of THEIR company (from the company CONTEXT). Offer it. "happy to share … if of interest."

- Day 14 (LinkedIn message, 30-50 words). Honest, low-pressure LI nudge. "Totally understand if these aren't useful." Then tie directly to their core job in their own words ("if [the core question their role carries] is on your plate this quarter, that's exactly what we do") and offer to show them their live pipeline. NEVER offer homework. Set subject to empty string.

- Day 21 (email, 30-45 words). Breakup. Warm, not bitter. Reinforce that the product is always-on: "the signals run automatically, so the moment [a relevant trigger in their world] happens, we'll have flagged it." Offer to switch it on for their accounts. Then step back.

═══ STEP 3 — WRITING RULES (NON-NEGOTIABLE) ═══

PRODUCT + HONESTY (the rules we learned the hard way):
- The product MUST be visible in every message, shown through a concrete offer (a list, named companies, a data cut, a live view), never through feature-speak or a meeting request.
- NEVER invent specifics. No precise counts you can't verify (use "several" / "a few"). No named companies unless they're in CONTEXT. No made-up statistics, ever.
- NEVER cite third-party stats or external reports. Only claim what OUR OWN data and signals tell us. It is always safer to talk about what we track than to quote someone else's number.
- ONLY claim capabilities ${sellerName} actually has. Every capability you mention must trace to value_propositions / capabilities / products_services in CONTEXT. If it's not there, we don't do it.
- Never offer the contact homework (a doc/one-pager for THEM to read). Offer to show or hand THEM something instead.
- Take NO stance on news, regulation, or the contact's situation. State facts neutrally. The contact may feel differently than you.

PUNCTUATION:
- NO em dashes (—). Use commas, periods, or parentheses. Zero exceptions.
- NO semicolons unless truly unavoidable.

SUBJECT LINES:
- SENTENCE CASE ONLY. Capitalize the first word, leave proper nouns + acronyms as-is, lowercase everything else.
  - "Quick question about CMC capacity" ✓
  - "Following up on the BIOSECURE shift" ✓
  - "Quick Question About CMC Capacity" ✗
  - "A Note On Your VP-CMC Search" ✗
- Short (under 60 chars). Lowercase reads as a peer, Title Case reads as marketing.

PLAIN LANGUAGE (8th-grade reading level):
- Short sentences. A 13-year-old should follow every line.
- No essay-style headers inside the body ("What we do:"). Write in sentences.
- Industry shorthand the contact uses is fine (TA, CMC, CDMO). Spell out any Act / programme / initiative in full the first time ("the BIOSECURE Act").

BANNED PHRASES (do not use, even as a variant):
- "bumping this", "circling back", "just following up", "checking in", "touching base", "wanted to follow up"
- "hope this finds you well", "hope you're doing well", "trust this email finds you"
- "swap" (noun), "comparing notes", "domain-credible", "telegraphs", "tends to outpace", "one pattern worth flagging"
- "I noticed ${contactCompanyName || 'your company'} is…" or any variant summarising their employer's news back at them ${opts.anchorIsContactLevel ? '' : `(the anchor's biggest trap)`}
- "leverage", "synergies", "circle up", "loop you in"
- "I help companies like yours" / "we work with companies like" (generic openers)
- "as I mentioned" / "circling back on" / "following up on" / "re: your [signal]" — the signal lives in Day 1 only.

VOICE:
- Conversational, peer-to-peer. You and the contact both know this market. Don't teach them things they already know.
- First name only ("${firstName}"). Never "Hi ${fullName}" or "Dear ${firstName}".
- Subject lines: 3-6 words, lowercase except proper nouns, all different from each other.

═══ GOLD-STANDARD EXAMPLE (study the shape, do not copy the content) ═══

This is a real sequence to a Director of Business Development at a CDMO, from a life-sci signals company. Note: human opener, signal acknowledged once then dropped, a concrete offer in every message, product reveal + differentiator on the Day 8 LinkedIn message, our-own-data only, no homework, no stance, plain language.

Day 1 (email): "Kumar, congrats on the director role. I wanted to reach out because the BIOSECURE Act is changing how US biotechs pick CDMOs, and a lot of that decision-making happens quietly, often before it reaches the press. We track buying signals across life-sci and turn them into a ranked, enriched list of who's ready to talk. One we can run: US West Coast biotechs with Chinese-CDMO exposure, matched to recent CMC hires and funding, with contacts included. A live shortlist of who's likely weighing a new partner right now. Happy to share if of interest."

Day 4 (email): "Kumar, quick one. We're already tracking several West Coast Series B oncology biotechs that posted VP-CMC roles in the last 30 days, all aligned to Enzene's therapeutic areas. Happy to share these with you if of interest."

[Day 7 — LinkedIn invite, sent by lemlist as a no-note connect request, no copy generated]

Day 8 (LinkedIn message):"Kumar, quick context on what sits behind those lists. Most signal tools are built for generic B2B and miss what matters in biotech. Ours is life-sci only, built by a team that reads the science. We track funding, CMC and exec hires, 8-K filings, partnerships, and clinical and regulatory moves, then enrich each one with the decision-maker and their contact details, into your CRM. Happy to show you live."

Day 11 (email): "Kumar, follow-on. We track US biotechs currently exposed to Chinese CDMOs. Happy to share the list, filtered to your therapeutic areas, if of interest."

Day 14 (LinkedIn message): "Kumar, totally understand if this isn't useful. If finding the next 5 US biotech customers is on your plate this quarter, that's what we do, continuously, enriched, routed into your CRM. Happy to show you your live pipeline."

Day 21 (email): "Kumar, closing the loop. The signals run automatically, so the moment a US West Coast biotech enters its CDMO RFP window, we'll have flagged it with the contacts ready. If you'd like that switched on for your accounts, I'm here."
${toneBlock ? `\n${toneBlock}\n` : ''}
CONTEXT:
${contextBlock}

═══ OUTPUT ═══
Strict JSON, no prose, no markdown fences:
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
