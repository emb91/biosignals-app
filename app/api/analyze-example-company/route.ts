import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import {
  COMPANY_SIZE_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  MODALITY_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  canonicalizeCompanyType,
  canonicalizeModality,
  canonicalizeTherapeuticArea,
  expandModalitiesWithParents,
} from '@/lib/arcova-taxonomy';

function canonicalizeArray<T extends string>(
  value: unknown,
  canonicalize: (item: unknown) => T | null
): T[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const result: T[] = [];

  for (const item of items) {
    const canonical = canonicalize(item);
    if (canonical && !result.includes(canonical)) result.push(canonical);
  }

  return result;
}

function normalizeAnalysisData(
  analysisData: Record<string, unknown>,
  url: string
): Record<string, unknown> {
  const modalities = expandModalitiesWithParents(
    canonicalizeArray(analysisData.modality || analysisData.modalities, canonicalizeModality)
  );
  const therapeuticAreas = canonicalizeArray(
    analysisData.therapeutic_area || analysisData.therapeuticArea || analysisData.therapeutic_areas,
    canonicalizeTherapeuticArea
  );

  return {
    companyName: analysisData.company_name || analysisData.companyName || extractCompanyNameFromUrl(url),
    therapeuticArea: therapeuticAreas[0] || null,
    therapeuticAreas,
    modality: modalities,
    fundingStage: analysisData.funding_stage || analysisData.fundingStage || null,
    companySize: analysisData.company_size || analysisData.companySize || analysisData.headcount || null,
    developmentStage:
      analysisData.development_stage || analysisData.developmentStage || analysisData.pipeline_stage || null,
    companyType: canonicalizeCompanyType(analysisData.company_type || analysisData.companyType),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Check if n8n workflow is configured (preferred method)
    const n8nWebhookUrl = process.env.N8N_FIRMOGRAPHICS_WEBHOOK;
    
    if (n8nWebhookUrl) {
      // Use n8n workflow for better scraping and analysis
      console.log('Using n8n workflow for firmographics analysis');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
      
      try {
        const response = await fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ website: url }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error('n8n webhook failed:', response.status);
          throw new Error('n8n workflow failed');
        }

        const rawData = await response.json();
        console.log('Raw n8n response:', JSON.stringify(rawData, null, 2));
        
        // Parse n8n response - handle various formats
        let analysisData;
        
        // Anthropic format: [{ content: [{ type: "text", text: "```json\n{...}\n```" }] }]
        if (rawData[0]?.content?.[0]?.text) {
          const textContent = rawData[0].content[0].text;
          const jsonMatch = textContent.match(/```json\n?([\s\S]*?)\n?```/);
          if (jsonMatch) {
            try {
              analysisData = JSON.parse(jsonMatch[1]);
            } catch (e) {
              console.error('Failed to parse JSON from code block:', e);
            }
          }
          if (!analysisData) {
            try {
              analysisData = JSON.parse(textContent);
            } catch (e) {
              console.error('Failed to parse text as JSON:', e);
            }
          }
        }
        // Direct JSON format
        else if (rawData[0]?.json) {
          analysisData = rawData[0].json;
        } else if (rawData[0] && typeof rawData[0] === 'object' && !rawData[0].content) {
          analysisData = rawData[0];
        } else if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
          analysisData = rawData;
        }

        if (analysisData) {
          return NextResponse.json(normalizeAnalysisData(analysisData, url));
        }
      } catch (n8nError) {
        console.error('n8n workflow error, falling back to direct analysis:', n8nError);
        // Fall through to direct Anthropic analysis
      }
    }

    // Fallback: Direct Anthropic analysis
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        { error: 'Analysis service not configured' },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Try to fetch the website content
    let pageContent = '';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ArcovaScraper/1.0)',
        },
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const html = await response.text();
        pageContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 15000);
      }
    } catch (fetchError) {
      console.log('Could not fetch website, will use URL only:', fetchError);
    }

    const prompt = `Analyze this life science company and extract key firmographic attributes.

Website URL: ${url}
${pageContent ? `\nWebsite content:\n${pageContent}` : ''}

Based on the URL${pageContent ? ' and website content' : ''}, infer the following about this company. Use your knowledge of the life sciences industry. If you cannot determine something with reasonable confidence, use null.

Return a JSON object with these fields:
{
  "companyName": "The company name (required, infer from URL if needed)",
  "therapeuticAreas": ["All relevant values from: ${THERAPEUTIC_AREA_OPTIONS.join(', ')}"],
  "modality": ["All relevant values from: ${MODALITY_OPTIONS.join(', ')}"],
  "fundingStage": "Funding stage from: ${FUNDING_STAGE_OPTIONS.join(', ')} or null",
  "companySize": "Headcount range from: ${COMPANY_SIZE_OPTIONS.join(', ')} or null",
  "developmentStage": "Most advanced pipeline stage from: ${DEVELOPMENT_STAGE_OPTIONS.join(', ')} or null",
  "companyType": "Company type from: ${COMPANY_TYPE_OPTIONS.map((option) => option.value).join(', ')} or null"
}

Do not include em dashes in your response.
Return ONLY the JSON object, no explanation or markdown formatting.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as { type: string; text: string }).text.trim();
    
    let companyData;
    try {
      companyData = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        companyData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse company data');
      }
    }

    return NextResponse.json(normalizeAnalysisData(companyData, url));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error analyzing company:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to analyze company' },
      { status: 500 }
    );
  }
}

function extractCompanyNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove www. and .com/.io/etc
    return hostname
      .replace(/^www\./, '')
      .replace(/\.(com|io|co|org|net|bio|health|pharma|med).*$/, '')
      .split('.')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  } catch {
    return url;
  }
}
