import { NextResponse } from 'next/server';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { completeLlm } from '@/lib/llm-client';
import { guardAuthenticatedAction } from '@/lib/api-security';

export async function POST(request: Request) {
  const guard = await guardAuthenticatedAction(request, {
    action: 'generate-contact-name',
    maxBodyBytes: 32_000,
  });
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { targetCompanyProfile, selectedFunctions, selectedSeniority } = body;

    if (!selectedFunctions?.length || !selectedSeniority?.length) {
      return NextResponse.json(
        { error: 'Business areas and seniority are required' },
        { status: 400 }
      );
    }

    const companyType = targetCompanyProfile?.company_type || 'Biotech';
    const companyProfileName = targetCompanyProfile?.name || companyType;

    const cleanupName = (text: string): string => {
      let cleaned = text.trim();

      // Strip any thinking preamble (e.g. "Wait, let me..." or "Here's...")
      const noisePatterns = /^(wait|actually|here'?s|let me|hmm|ok|okay|sure|so|note)[,:\s].*/i;
      const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
      cleaned = lines.find(line => !noisePatterns.test(line)) || lines[lines.length - 1] || cleaned;

      // Remove surrounding quotes
      cleaned = cleaned.replace(/^["']+|["']+$/g, '');

      const noTrailingPunctuation = cleaned.replace(/[.!?,;:]+$/g, '');
      const normalised = noTrailingPunctuation.replace(/\s+/g, ' ').trim();
      const words = normalised.split(' ').slice(0, 6);
      let output = words.join(' ');

      const parts = output.split('&');
      if (parts.length > 2) {
        output = `${parts[0]}&${parts.slice(1).join(' and ')}`.replace(/\s+/g, ' ').trim();
      }

      return output;
    };

    const teamCount = selectedFunctions.length;

    const allSeniorityLevels = [
      'C-Level',
      'VP / SVP',
      'Director',
      'Head of / Senior Manager',
      'Manager',
      'Individual Contributor',
    ];
    const selectedSenioritySet = new Set(selectedSeniority);
    const allSenioritiesSelected = allSeniorityLevels.every(level => selectedSenioritySet.has(level));

    const hasSeniorLeadership =
      selectedSenioritySet.has('C-Level') ||
      selectedSenioritySet.has('VP / SVP') ||
      selectedSenioritySet.has('Director') ||
      selectedSenioritySet.has('Head of / Senior Manager');
    const hasManager = selectedSenioritySet.has('Manager');
    const hasIndividualContributor = selectedSenioritySet.has('Individual Contributor');

    let broadTeamDescriptor: string | null = null;
    if (teamCount > 3) {
      if (allSenioritiesSelected) broadTeamDescriptor = 'Teams';
      else if (hasSeniorLeadership) broadTeamDescriptor = 'Senior teams';
      else if (hasManager) broadTeamDescriptor = 'Managers';
      else if (hasIndividualContributor) broadTeamDescriptor = 'Individual contributors';
      else broadTeamDescriptor = 'Teams';
    }

    const fallbackPrefix = broadTeamDescriptor || selectedFunctions[0] || 'Commercial';
    const fallbackName = `${fallbackPrefix} at ${companyProfileName}`;

    const teamGuidance = teamCount <= 2
      ? `Name the specific teams (e.g. "BD & Clinical").`
      : teamCount <= 3
      ? `Summarise the teams with a theme like "Commercial" or "Scientific".`
      : `There are ${teamCount} teams selected, which is broad. Use seniority-led language instead of team names.`;

    const prompt = `Generate ONLY the short descriptor before "at" for a buyer segment name. I will append "at ${companyProfileName}" myself.

Business areas: ${selectedFunctions.join(', ')}
Seniority levels: ${selectedSeniority.join(', ')}

Rules:
- Maximum 3 words
- ${teamGuidance}
- ${broadTeamDescriptor ? `For this input, the descriptor must be exactly "${broadTeamDescriptor}".` : 'Use the best descriptor from teams and seniority.'}
- Do not use the phrase "cross-functional"
- Do not lead with a seniority level. Lead with the role or team theme.
- Do not reference "all levels" or list seniority ranges
- Do not use generic filler words like "leaders", "professionals", "contacts", "people", or "individuals"
- Do not use ampersands more than once
- Do not include "at" or the company name
- No punctuation at the end
- No em dashes

Examples of good descriptors:
- Commercial VPs
- Scientific Directors
- BD & Clinical
- Teams
- R&D Leadership
- Buyers`;

    const completion = await completeLlm({
      feature: 'generate_contact_name',
      prompt,
      maxTokens: 20,
      temperature: 0.7,
      system: 'You are a naming tool. Output only the descriptor, nothing else. No thinking, no explanation, no quotes.',
    });

    await recordLlmUsageEvent({
      provider: completion.provider,
      feature: 'generate_contact_name',
      route: 'app/api/generate-contact-name',
      model: completion.model,
      usage: completion.usage,
    });

    const rawPrefix = completion.text.trim();
    let cleanedPrefix = cleanupName(rawPrefix);
    if (broadTeamDescriptor && cleanedPrefix.toLowerCase() !== broadTeamDescriptor.toLowerCase()) {
      cleanedPrefix = broadTeamDescriptor;
    }
    const name = cleanedPrefix ? `${cleanedPrefix} at ${companyProfileName}` : fallbackName;

    return NextResponse.json({ name });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating contact name:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to generate name' },
      { status: 500 }
    );
  }
}
