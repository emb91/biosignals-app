import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const ALL_SIGNALS = [
  // Funding & Financial
  { id: 'new_funding', name: 'New funding round', category: 'Funding & Financial' },
  { id: 'ipo', name: 'IPO', category: 'Funding & Financial' },
  { id: 'grant_award', name: 'Grant award', category: 'Funding & Financial' },
  { id: 'partnership_deal', name: 'Partnership or licensing deal', category: 'Funding & Financial' },
  { id: 'ma', name: 'M&A', category: 'Funding & Financial' },
  
  // Pipeline & Clinical
  { id: 'clinical_trial', name: 'Clinical trial registered', category: 'Pipeline & Clinical' },
  { id: 'phase_transition', name: 'Phase transition', category: 'Pipeline & Clinical' },
  { id: 'indication_expansion', name: 'New indication expansion', category: 'Pipeline & Clinical' },
  { id: 'breakthrough_designation', name: 'Breakthrough / fast track designation', category: 'Pipeline & Clinical' },
  { id: 'fda_approval', name: 'FDA approval or clearance', category: 'Pipeline & Clinical' },
  
  // Hiring & Team
  { id: 'cmc_hire', name: 'CMC / manufacturing hire', category: 'Hiring & Team' },
  { id: 'clinical_ops_hire', name: 'Clinical operations hire', category: 'Hiring & Team' },
  { id: 'bd_hire', name: 'BD or partnerships hire', category: 'Hiring & Team' },
  { id: 'regulatory_hire', name: 'Regulatory affairs hire', category: 'Hiring & Team' },
  { id: 'csuite_hire', name: 'C-suite or VP hire', category: 'Hiring & Team' },
  { id: 'job_surge', name: 'Job postings surge', category: 'Hiring & Team' },
  
  // Corporate & Strategic
  { id: 'company_founded', name: 'Company founded', category: 'Corporate & Strategic' },
  { id: 'new_facility', name: 'New office or facility', category: 'Corporate & Strategic' },
  { id: 'conference_presentation', name: 'Conference presentation or poster', category: 'Corporate & Strategic' },
  { id: 'publication', name: 'Publication in peer-reviewed journal', category: 'Corporate & Strategic' },
  { id: 'press_release', name: 'Press release or news mention', category: 'Corporate & Strategic' },
];

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        { error: 'Anthropic API key not configured' },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const body = await request.json();
    const { companyType, companySizes, therapeuticAreas, modalities, developmentStages, fundingStages } = body;

    const signalList = ALL_SIGNALS.map(s => `- ${s.id}: ${s.name} (${s.category})`).join('\n');

    const prompt = `You are helping a B2B sales team in the life sciences industry select the most relevant buying signals to track for their ideal customer profile.

Their ICP criteria:
- Company Type: ${companyType || 'Not specified'}
- Company Sizes: ${companySizes?.join(', ') || 'Any'}
- Therapeutic Areas: ${therapeuticAreas?.join(', ') || 'Any'}
- Modalities: ${modalities?.join(', ') || 'Any'}
- Development Stages: ${developmentStages?.join(', ') || 'Any'}
- Funding Stages: ${fundingStages?.join(', ') || 'Any'}

Available signals to choose from:
${signalList}

Based on this ICP, select EXACTLY 5 MOST relevant signals that would indicate a company matching this profile is likely to be in a buying window. Order them by importance (most important first). Consider:
- What events typically precede purchasing decisions for this type of customer?
- What signals indicate growth, expansion, or new initiatives?
- What hiring patterns suggest they're building capabilities your seller might support?

Return ONLY a JSON array of signal IDs (the part before the colon), ordered by relevance. Example: ["new_funding", "clinical_trial", "cmc_hire"]

Do not include em dashes in your response.
Return ONLY the JSON array, nothing else.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as { type: string; text: string }).text.trim();
    
    let recommendedIds: string[];
    try {
      recommendedIds = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        recommendedIds = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse signal recommendations');
      }
    }

    // Map IDs to full signal objects
    const recommendedSignals = recommendedIds
      .map(id => ALL_SIGNALS.find(s => s.id === id))
      .filter(Boolean);

    return NextResponse.json({ 
      recommended: recommendedSignals,
      all: ALL_SIGNALS 
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error recommending signals:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to recommend signals' },
      { status: 500 }
    );
  }
}

// GET endpoint to return all signals (for fallback)
export async function GET() {
  return NextResponse.json({ all: ALL_SIGNALS });
}
