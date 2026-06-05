/**
 * POST /api/outreach/sequence
 *
 * Generates a 6-message outreach sequence anchored to a chosen hook.
 * Day offsets: 1, 4, 8, 11, 14, 21 (Day 7 LinkedIn invite is injected at stage,
 * no copy). Booking link comes from the user's Settings CTA URL; tone of voice
 * from Settings overlays the house voice. See outbound-sequence-prompt-v2.
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
import { fetchOutreachTone, renderToneBlock } from '@/lib/outreach-tone';

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
      // Cadence is owned by the lemlist template, NOT the LLM — pin each step to
      // its canonical day_offset by position so a stray model value can't push a
      // step off-cadence and make the stage endpoint's channel map (keyed on the
      // exact day) misfire to email. The model's day_offset is ignored.
      const dayOffset = DAY_OFFSETS[i] ?? DAY_OFFSETS[DAY_OFFSETS.length - 1];
      const subject = typeof o.subject === 'string' ? scrubAiTropes(o.subject.trim()) : '';
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
        // Lean heavily on the rich structured context already captured in setup —
        // positioning, targeting (good/bad fit, buyer prerequisites), and substance.
        'company_name, tagline, description, products_services, services, value_propositions, ' +
          'differentiated_value, unique_characteristics, business_model, market_summary, status_quo, ' +
          'capabilities, challenges_addressed, customer_benefits, customers_we_serve, why_customers_buy, ' +
          'target_customers, good_fit, bad_fit, buyer_prerequisites, buyer_disqualifiers, ' +
          'competitors, industries, technologies, specialties, ' +
          'therapeutic_areas, modalities, development_stages, platform_category, ' +
          'customer_therapeutic_areas, customer_modalities, customer_development_stages'
      )
      .eq('user_id', user.id)
      .maybeSingle();

    // Tone of voice (Settings) → optional prompt block; empty string when unset
    // (the prompt's house voice carries it). Booking link = Settings CTA URL;
    // empty → the prompt omits the booking-link sections entirely (Option 2).
    const tone = await fetchOutreachTone(supabase, user.id);
    const toneBlock = renderToneBlock(tone);
    let bookingLink = '';
    {
      const { data: settings } = await supabase
        .from('user_outreach_settings')
        .select('cta_url')
        .eq('user_id', user.id)
        .maybeSingle();
      const url = (settings as { cta_url?: string | null } | null)?.cta_url ?? '';
      bookingLink = typeof url === 'string' ? url.trim() : '';
    }

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
      bookingLink,
      toneBlock,
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
  /** Settings CTA URL — empty string omits all booking-link instructions. */
  bookingLink: string;
  /** Rendered tone-of-voice block — empty string when the user hasn't set one. */
  toneBlock: string;
}): string {
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
            services: opts.selfCompany.services,
            value_propositions: opts.selfCompany.value_propositions,
            differentiated_value: opts.selfCompany.differentiated_value,
            unique_characteristics: opts.selfCompany.unique_characteristics,
            business_model: opts.selfCompany.business_model,
            market_summary: opts.selfCompany.market_summary,
            status_quo: opts.selfCompany.status_quo,
            capabilities: opts.selfCompany.capabilities,
            challenges_addressed: opts.selfCompany.challenges_addressed,
            customer_benefits: opts.selfCompany.customer_benefits,
            customers_we_serve: opts.selfCompany.customers_we_serve,
            why_customers_buy: opts.selfCompany.why_customers_buy,
            // Targeting — sharpens who-we-sell-to relevance the v2 prompt cares about.
            target_customers: opts.selfCompany.target_customers,
            good_fit: opts.selfCompany.good_fit,
            bad_fit: opts.selfCompany.bad_fit,
            buyer_prerequisites: opts.selfCompany.buyer_prerequisites,
            buyer_disqualifiers: opts.selfCompany.buyer_disqualifiers,
            competitors: opts.selfCompany.competitors,
            industries: opts.selfCompany.industries,
            technologies: opts.selfCompany.technologies,
            specialties: opts.selfCompany.specialties,
            therapeutic_areas: opts.selfCompany.therapeutic_areas,
            modalities: opts.selfCompany.modalities,
            development_stages: opts.selfCompany.development_stages,
            platform_category: opts.selfCompany.platform_category,
            customer_therapeutic_areas: opts.selfCompany.customer_therapeutic_areas,
            customer_modalities: opts.selfCompany.customer_modalities,
            customer_development_stages: opts.selfCompany.customer_development_stages,
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

  const signalCategories = opts.anchorSignalType || 'unspecified';
  const hasBooking = opts.bookingLink.trim().length > 0;

  // Option 2: booking link comes from the user's Settings CTA URL. When unset,
  // every booking-link instruction is swapped for a "no link" variant so
  // generation still runs cleanly, just without a CTA.
  const ctaRule = hasBooking
    ? `(c) The booking link ${opts.bookingLink} appears in EVERY message, on its own line, just before the sign-off. No exceptions. The framing escalates: early touches offer a list or sample cut, later touches offer a short demo, but the link is always there, always paired with an easy out. A soft, low-pressure demo offer is encouraged; a hard "got 15 minutes Thursday?" is not.`
    : `(c) Do NOT include any booking link or scheduling URL in any message — none is configured. Still make a concrete offer and a soft, low-pressure demo mention where natural, but end each message at the sign-off with no link.`;
  const ctaArc = hasBooking ? ' Booking link, then sign-off.' : ' Then sign-off.';
  const ctaArcShort = hasBooking ? ' Booking link.' : '';
  const outputCta = hasBooking
    ? 'The body must include the booking link on its own line and the sign-off.'
    : 'The body ends with the sign-off; do NOT include any booking or scheduling link.';
  const leakCta = hasBooking
    ? `The booking link is ${opts.bookingLink}, not the example's link.`
    : `There is NO booking link configured, so NO calendar/scheduling URL may appear in any message (the example's calendly link must not be copied).`;

  return `You are a sales rep at ${sellerName}, writing a 7-step outreach sequence to ${firstName} (${opts.contact.job_title ?? 'unknown title'}) at ${contactCompanyName || 'their company'}. You write the way a friendly, slightly informal founder types a quick note to a peer. Not like marketing. Not like AI.

SIGNAL CONTEXT (optional, mostly inert):
${signalCategories}  ← the category that triggered this contact's enrolment. Raw detail is in the anchor below if you ever want to look: "${opts.anchorHookText}"
This is background only. It explains WHY this account was picked and timed, nothing more. Do NOT reference it in the copy and do not treat it as something the contact wants to hear about. At most, a category may quietly nudge which angle or offer feels most relevant. The default is to ignore it and write to the persona.

═══ STEP 1 — THINK BEFORE WRITING ═══
Do this reasoning silently, then use it to shape every message. Do not output the reasoning.

1. WHAT FUNCTION DOES ${firstName} WORK IN?
   Use the CONTEXT (title, seniority, business_area, bio). What do they own day-to-day? What are they measured on? What problems land on their desk versus someone else's?

2. DOES THE SIGNAL CATEGORY ADD ANYTHING? (usually no)
   ${scopeRules}
   The signal category is qualification context only — it tells us this account has budget or momentum, which is why it was enrolled now. It is almost never worth surfacing. Never recite the contact's own company news back to them (that they filed a patent, published a paper, are hiring); it's creepy and generic. Only let a category subtly shape your angle or which offer you lead with if it genuinely helps. Otherwise write to the persona and ignore the signal entirely.

3. WHICH 2-3 ITEMS FROM our_company ACTUALLY MAP TO ${firstName}'S ROLE?
   Don't pick our most flattering value-prop. Pick the ones a person in this exact function would care about. Ignore the rest. Use our_company.good_fit / bad_fit / buyer_prerequisites to judge what actually resonates with someone in their seat.

4. WHAT WOULD MAKE ${firstName} ROLL THEIR EYES OR SMELL A BOT?
   - Being told their own company's news as if it's a tip
   - Being lectured about their own job, market or product ("selling X comes down to Y", "here's where your platform wins")
   - Generic "I help companies like yours…" openers
   - A hard pitch in message 1
   - Tidy, balanced, over-polished sentences, rule-of-three lists, and "we don't do X, we do Y" framing — all classic AI tells
   - Opening with just their name and a comma, with no greeting

═══ STEP 2 — WRITE THE 6 MESSAGES ═══

VOICE — THE MOST IMPORTANT SECTION. Match this in every message, or it will read as AI.

1. Greeting always. Start every message with "Hi ${firstName}," on its own line, then the body. Never open with "${firstName}, ...".
2. Be honest about the outreach. Say where you are in the sequence, warmly: "Hope you don't mind me reaching out cold." "Just wanted to follow up in case my last message got missed." "Thanks for connecting." "I know I've sent you a couple of emails already." "I'll leave it here so I'm not filling up your inbox." Never pretend this is the first or only touch.
3. Give them an out, every time. Add a low-pressure aside that makes saying no easy: "(totally fair)", "if that would be interesting for you", "if it's not a priority right now, that's totally fair", "or let me know if nothing suits".
4. Be humble, not slick. Assume they have never heard of ${sellerName}. Plainness beats polish. A little natural repetition reads human and is fine.
5. Let sentences breathe. Real people write slightly long, comma-joined sentences when they're being friendly. Do not make every line crisp, parallel or balanced. No "we don't do X, we do Y" antithesis. No tidy rule-of-three lists.
6. Never lecture the expert. The reader knows their own job, market and product better than you. Naming a shared frustration is good ("it can be hard to know which prospects are ready, and at the right time"). Instructing them is not.
7. Explain plainly, with examples, drawn from our_company. Not feature-speak.
8. Make the payoff concrete and company-specific, but DON'T OVER-PROMISE. "For ${contactCompanyName}, this can mean months of lead time ahead of competitors." Hedge with "can", "often", "usually" — never absolute guarantees. Name real filters when you can, from our_company / company context.
9. Warm, varied sign-offs. Rotate naturally: "Cheers, ${firstName}", "Kind regards, ${firstName} (from ${sellerName})", "All the best, ${firstName}". Casual and first-name-only on LinkedIn, fuller on email. Never identical every time. (Replace ${firstName} here with the SELLER's name, from CONTEXT.our_company.name.)
10. British spelling (programmes, organise), contractions throughout, "e.g." inline is fine.

THE OFFER AND THE CTA:
(a) The product is visible in EVERY message, shown by OFFERING SOMETHING CONCRETE the contact can have (a list, a sample cut, a quick demo), never by describing features. If a message offers nothing concrete, it's filler. Cut it.
(b) Lead with what we ALREADY HAVE (off-the-shelf), then layer custom on top.
${ctaRule}

═══ THE ARC ═══
Day 1 (email) → Day 4 (email) → [Day 7 LinkedIn INVITE — pure action, no copy] → Day 8 (LinkedIn message) → Day 11 (email) → Day 14 (LinkedIn message) → Day 21 (email)
warm cold open + offer → honest follow-up + a data cut → [connect request action] → product nuance + demo offer → another data cut → low-pressure nudge → always-on close

YOU WRITE COPY FOR EXACTLY 6 MESSAGES — Day 1, 4, 8, 11, 14, 21. The Day 7 LinkedIn connect request is a pure action step, so DO NOT generate a Day 7 entry. Your messages[] output must contain exactly 6 entries in that order.

CHANNEL + LENGTH (treat the gold-standard example as the real guide; ranges are approximate):
- Day 1 — EMAIL, ~90-120 words. Warm cold open. One plain sentence on what ${sellerName} does. Offer a list of accounts in their territory.${ctaArc}
- Day 4 — EMAIL, ~50-80 words. Honest follow-up ("in case my last message got missed"). Offer a specific data cut we ALREADY track, with real filters. Use "a few" / "several", never a precise number you can't verify.${ctaArc}
- Day 8 — LINKEDIN MESSAGE, ~80-120 words, no subject. "Thanks for connecting." Share the ONE thing that sets us apart (from differentiated_value), explained plainly with an e.g. Spell out the company-specific payoff, hedged. Offer a live demo.${ctaArc}
- Day 11 — EMAIL, ~25-50 words. Another concrete data cut, different from Day 4's, tied to a strength of THEIR company.${ctaArc}
- Day 14 — LINKEDIN MESSAGE, ~40-70 words, no subject. Honest, low-pressure nudge. Never offer homework. Offer the demo.${ctaArcShort}
- Day 21 — EMAIL, ~40-70 words. Warm breakup, not bitter. Reinforce that we monitor signals always-on.${ctaArc}

═══ STEP 3 — WRITING RULES (NON-NEGOTIABLE) ═══

PRODUCT + HONESTY:
- CONTENT SOURCE (critical): every concrete claim — product, positioning, services, proof points, signal types, filters, and the offer you extend — must come from CONTEXT.our_company for THIS seller. NONE of it may be borrowed from the gold-standard example. The example is voice only. If our_company sells lab services, the messages are about lab services, not about signal tracking.
- The product MUST be visible in every message, shown through a concrete offer.
- NEVER invent specifics. No named companies unless they're in CONTEXT. No made-up statistics, ever.
- NEVER cite third-party stats or external reports. Only claim what OUR OWN data tells us.
- ONLY claim capabilities ${sellerName} actually has (must trace to value_propositions / capabilities / products_services in CONTEXT).
- Don't over-promise. Hedge outcomes with "can", "often", "usually".
- Offer to show or hand THEM something. Never set the contact homework.
- Take NO stance on news, regulation, or the contact's situation.

PUNCTUATION: NO em dashes (—) ever. Use commas and full stops. NO semicolons unless truly unavoidable.

SUBJECT LINES (emails only — Day 8 and Day 14 have none): SENTENCE CASE. Capitalise the first word and proper nouns only. 3 to 5 words, under 50 characters. No title case, no all-lowercase.

PLAIN LANGUAGE (8th-grade reading level): short sentences, everyday words. Spell out any Act or programme in full the first time.

BANNED PHRASES (empty filler only): "bumping this", "circling back", "touching base", "hope this finds you well", "leverage", "synergies", "I help companies like yours", "I noticed ${contactCompanyName} is…". NOTE: honest, specific follow-up framing like "just wanted to follow up in case my last message got missed" is GOOD and encouraged — only the contentless versions are banned.

═══ GOLD-STANDARD EXAMPLE — FOR VOICE ONLY, NOT CONTENT ═══
Use the example below ONLY to learn tone, rhythm, warmth, sentence shape, greeting and sign-off style, and the structure of the arc. It is written for a DIFFERENT seller (Arcova), selling a DIFFERENT product, to a DIFFERENT person. Borrow its MUSIC, never its words.

EVERYTHING CONCRETE IN IT BELONGS TO ARCOVA AND MUST NOT APPEAR IN YOUR OUTPUT, including:
- the company and product category (signal tracking, lead enrichment, CRM routing, 24/7 monitoring)
- the specific signals and filters (lab buildouts, diagnostic programmes, trials, modality, therapeutic area, Series A)
- the offers (pulling a list of accounts, showing accounts live)
- the booking link, and the names Arcova / Emma / Althea / Illumina

Pull 100% of your substance — what ${sellerName} does, its positioning, services, proof points, the concrete thing you offer${hasBooking ? ', and the booking link' : ''} — from CONTEXT.our_company${hasBooking ? ' and the configured booking link' : ''}. If a detail is not in CONTEXT for THIS seller, do not use it. The example below is illustrative only.

Worked example (Arcova → Althea, Senior Manager of Sales at Illumina; seller name in sign-offs is Emma):

--- Day 1 · EMAIL · subject: "Labs ready to buy" ---
Hi Althea,

Hope you don't mind me reaching out to you cold. I just know that it can be hard to know which prospects are ready to buy, and at the right time, which is something we do really well.

We track the early signals that point to their 'readiness' to buy, including e.g. new lab buildouts, diagnostic programmes starting up, research grants, and then match these up with the right contact, and route them straight into your CRM.

I can pull a list of accounts in your territory showing those signals right now, and I'd be more than happy to demo for you if of interest.

https://calendly.com/emma-arcova/30min

Kind regards,
Emma (from Arcova)

--- Day 4 · EMAIL · subject: "In case it got buried" ---
Hi Althea,

Just wanted to follow up in case my last message got missed. In case you're not all over Arcova and what we do (totally fair), we keep an eye on research institutes and diagnostic labs across the US that show signs of buying, and cross-check against modality and therapeutic area.

Happy to share how it works if that would be interesting for you.

https://calendly.com/emma-arcova/30min

Cheers,
Emma (from Arcova)

--- Day 8 · LINKEDIN MESSAGE · no subject ---
Hi Althea,

Thanks for connecting. I know I've sent you a couple of emails already, but in case you missed them I just wanted to share some of the nuance that sets us apart.

While some data providers show info on some prospect signals (e.g. hiring), Arcova looks deeper into whether that actually translates into a buying signal, e.g. if a lab is registering a trial it often means they're about to scale.

For Illumina, this can mean months of lead time ahead of competitors.

I'd be more than happy to show you how this works live. If you're interested, please feel free to book a demo with me.

https://calendly.com/emma-arcova/30min

Cheers,
Emma

--- Day 11 · EMAIL · subject: "Clinical labs scaling sequencing" ---
Hi Althea,

We're tracking oncology labs all across the US that have recently raised Series A. Happy to share some of these leads if of any use.

https://calendly.com/emma-arcova/30min

Kind regards,
Emma (from Arcova)

--- Day 14 · LINKEDIN MESSAGE · no subject ---
Hi Althea,

If automating your GTM motion isn't a priority right now, that's totally fair. If it is, I'd love to demo how we work. Please feel free to book with me at a time that works, or let me know if nothing suits.

https://calendly.com/emma-arcova/30min

--- Day 21 · EMAIL · subject: "Leaving the door open" ---
Hi Althea,

I'll leave it here so I'm not filling up your inbox. We monitor signals across US life science companies 24/7, so if you're ever interested in automating some of your go-to-market operations, please feel free to reach out.

https://calendly.com/emma-arcova/30min

All the best,
Emma (from Arcova)

═══ INPUTS ═══
${opts.toneBlock}
CONTEXT:
${contextBlock}

═══ STEP 4 — LEAK CHECK BEFORE YOU OUTPUT ═══
Re-read all 6 messages silently and confirm each one:
- Every product detail, service, signal type, filter and offer traces to CONTEXT.our_company for THIS seller. Nothing was borrowed from the Arcova example.
- It contains NONE of these unless they genuinely appear in CONTEXT for this seller: signal tracking, enrichment, CRM routing, 24/7 monitoring, modality, therapeutic area, lab buildouts, Series A, or the names Arcova / Emma / Althea / Illumina.
- ${leakCta}
- The VOICE still matches the example: warm, honest about the outreach, humble, gives an out, greeting plus varied sign-off, concrete offer, no em dashes, no over-promising.
If anything leaked from the example, rewrite it from CONTEXT before producing the JSON.

═══ OUTPUT ═══
Strict JSON, no prose, no markdown fences. EXACTLY 6 messages on these exact day_offsets: 1, 4, 8, 11, 14, 21, in that order. Emails have a subject; LinkedIn messages (Day 8, Day 14) have an empty subject. ${outputCta}
{ "messages": [ { "day_offset": 1, "subject": "...", "body": "..." }, { "day_offset": 4, "subject": "...", "body": "..." }, { "day_offset": 8, "subject": "", "body": "..." }, { "day_offset": 11, "subject": "...", "body": "..." }, { "day_offset": 14, "subject": "", "body": "..." }, { "day_offset": 21, "subject": "...", "body": "..." } ] }`;
}
