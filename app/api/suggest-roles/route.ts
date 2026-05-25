import { NextResponse } from 'next/server';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { completeLlm } from '@/lib/llm-client';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      companyType,
      selectedBusinessArea,
      selectedBusinessAreas,
      seniority,
      availableTitles,
    } = body;

    if (!selectedBusinessArea || !availableTitles?.length || !seniority?.length) {
      return NextResponse.json(
        { error: 'Business area, seniority, and available titles are required' },
        { status: 400 }
      );
    }

    const prompt = `A life science company sells to ${companyType || 'biotech and pharmaceutical'} companies.

Target business area: ${selectedBusinessArea}
Selected business areas overall: ${(selectedBusinessAreas || []).join(', ') || selectedBusinessArea}
Selected seniority levels: ${seniority.join(', ')}

Available specific roles for this business area (use ONLY roles from this list):
${availableTitles.map((title: string) => `- ${title}`).join('\n')}

Pick the 2-5 most appropriate specific roles from the list above for this target profile.
Return ONLY a JSON array of strings. No explanation, no markdown. Do not include em dashes in your response.`;

    const completion = await completeLlm({
      feature: 'suggest_roles',
      prompt,
      maxTokens: 200,
    });

    await recordLlmUsageEvent({
      provider: completion.provider,
      feature: 'suggest_roles',
      route: 'app/api/suggest-roles',
      model: completion.model,
      usage: completion.usage,
    });

    const responseText = completion.text.trim();
    
    let titles: string[];
    try {
      titles = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        titles = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse titles');
      }
    }

    const validTitles = titles.filter((title) => availableTitles.includes(title));

    return NextResponse.json({ titles: validTitles });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error suggesting roles:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to suggest roles' },
      { status: 500 }
    );
  }
}
