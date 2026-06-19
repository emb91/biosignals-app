import { NextRequest, NextResponse } from 'next/server';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

export interface IcpSuggestion {
  name: string;
  domain: string;
  segmentLabel: string;
}

function arr(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'string') return v;
  return '';
}

export async function POST(req: NextRequest) {
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
    } = body;

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

Suggest 2–3 real, publicly-known companies that would make strong representative ICP model accounts for this seller. Prioritize companies that clearly fit the target customer segments they defined above. Each suggestion MUST represent a clearly different buyer segment — do not suggest two companies of the same type.

Return ONLY valid JSON, no other text:
{"suggestions":[{"name":"Company Name","domain":"example.com","segmentLabel":"2–4 word segment label"}]}

Rules:
- Only suggest companies you are highly confident are real and widely recognised
- Each must be a different buyer type or segment
- domain must be the primary website domain only (e.g. "pfizer.com" — no path, no www)
- segmentLabel describes the buyer category in 2–4 words (e.g. "Large Oncology Pharma", "Precision Biotech", "Global CRO")
- Aim for diversity: if the seller could have pharma, biotech, and CRO buyers, suggest one of each`;

    const completion = await completeLlm({
      feature: 'suggest_icp_companies',
      prompt,
      maxTokens: 512,
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
      .slice(0, 3);

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[suggest-icp-companies] error:', err);
    return NextResponse.json({ suggestions: [] });
  }
}
