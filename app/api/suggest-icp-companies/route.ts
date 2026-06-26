import { NextRequest, NextResponse } from 'next/server';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { guardAuthenticatedAction } from '@/lib/api-security';

export interface IcpSuggestion {
  name: string;
  domain: string;
  segmentLabel: string;
  /** One short sentence (two max) on why this is a strong ICP for the seller. */
  reason?: string;
}

interface ExistingIcpRef {
  name?: string;
  domain?: string;
  segment?: string;
}

function arr(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'string') return v;
  return '';
}

function describeExisting(refs: unknown): string {
  if (!Array.isArray(refs)) return '';
  return (refs as ExistingIcpRef[])
    .map((r) => {
      const name = typeof r?.name === 'string' ? r.name.trim() : '';
      const domain = typeof r?.domain === 'string' ? r.domain.trim() : '';
      const segment = typeof r?.segment === 'string' ? r.segment.trim() : '';
      const label = name || domain;
      if (!label) return '';
      return segment ? `${label} (${segment})` : label;
    })
    .filter(Boolean)
    .join(', ');
}

export async function POST(req: NextRequest) {
  const guard = await guardAuthenticatedAction(req, {
    action: 'suggest-icp-companies',
    maxBodyBytes: 48_000,
  });
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json() as Record<string, unknown>;
    const {
      company_name,
      description,
      products_services,
      services,
      target_customers,
      customers_we_serve,
      good_fit,
      therapeutic_areas,
      modalities,
      company_type,
      existing_icps,
    } = body;

    const existingList = describeExisting(existing_icps);

    const prompt = `You are helping a B2B sales intelligence platform identify ideal target accounts.

Seller: ${company_name ?? 'Unknown'}
Type: ${company_type ?? ''}
What they do: ${arr(description)}
Products / services: ${arr(products_services)}${arr(services) ? `\n${arr(services)}` : ''}
Target customer segments (primary ICP categories they defined): ${arr(target_customers)}
Who they sell to / customers served: ${arr(customers_we_serve)}
Good fit signals: ${arr(good_fit)}
Therapeutic areas: ${arr(therapeutic_areas)}
Modalities: ${arr(modalities)}
${existingList ? `\nProfiles the seller has ALREADY saved (do not suggest these or close equivalents): ${existingList}\n` : ''}
Assume the user does NOT know which company makes the best target account. Suggest real, publicly-known companies that would make strong representative ICP model accounts for this seller, ranked best-fit FIRST. The first suggestion must be your single strongest pick.

Return 4 suggestions so the user can ask for another if the first is not right. Each MUST represent a clearly different buyer (do not suggest two near-identical companies), and none may overlap a profile the seller has already saved.

Return ONLY valid JSON, no other text:
{"suggestions":[{"name":"Company Name","domain":"example.com","segmentLabel":"2–4 word segment label","reason":"One short sentence on why they are a strong target."}]}

Rules:
- Order by fit, strongest first
- Only suggest companies you are highly confident are real and widely recognised
- name must be the full, recognisable company name (e.g. "Charles River Laboratories", never "criver")
- domain must be the primary website domain only (e.g. "pfizer.com" — no path, no www)
- segmentLabel describes the buyer category in 2–4 words (e.g. "Large Oncology Pharma", "Precision Biotech", "Global CRO")
- reason is ONE sentence (two at most), plain and specific to this seller, on why this company is a strong target account. No em dashes.`;

    const completion = await completeLlm({
      feature: 'suggest_icp_companies',
      prompt,
      maxTokens: 768,
    });

    await recordLlmUsageEvent({
      provider: completion.provider,
      feature: 'suggest_icp_companies',
      route: 'app/api/suggest-icp-companies',
      model: completion.model,
      usage: completion.usage,
    });

    const raw = completion.text.trim();
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText) as { suggestions: IcpSuggestion[] };

    const suggestions: IcpSuggestion[] = (parsed.suggestions ?? [])
      .filter((s) => s && typeof s.name === 'string' && typeof s.domain === 'string')
      .map((s) => ({
        name: s.name,
        domain: s.domain,
        segmentLabel: typeof s.segmentLabel === 'string' ? s.segmentLabel : '',
        reason: typeof s.reason === 'string' ? s.reason.trim() : undefined,
      }))
      .slice(0, 4);

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[suggest-icp-companies] error:', err);
    return NextResponse.json({ suggestions: [] });
  }
}
