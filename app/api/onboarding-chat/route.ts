import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';

const client = new Anthropic();

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'capture_name',
    description:
      "Call this as soon as you have the user's first name or preferred name they want you to use, before you ask for their company domain or website.",
    input_schema: {
      type: 'object' as const,
      properties: {
        first_name: {
          type: 'string',
          description: "The user's first name or preferred name to use going forward.",
        },
      },
      required: ['first_name'],
    },
  },
  {
    name: 'begin_analysis',
    description:
      "Call this once you have the user's company website URL or bare domain. They may send it as soon as they are ready after your opening beats; you do not need a separate 'ready' message if the URL is clear. This triggers the business analysis.",
    input_schema: {
      type: 'object' as const,
      properties: {
        website_url: {
          type: 'string',
          description: 'The company website URL (e.g. https://acme.com)',
        },
      },
      required: ['website_url'],
    },
  },
];

/** Two chat bubbles only: welcome + setup payoff, then a short domain ask (no extra “why” bubble). */
function buildScriptedOnboardingSegments(displayName: string): string[] {
  const name = displayName.trim() || 'there';
  return [
    `Hey ${name}, welcome to Arcova. I'm going to help you get set up, so you can start finding and prioritising the right accounts and contacts for your business.`,
    `When you're ready to get started, please share your company domain here with me.`,
  ];
}

function buildSystemPrompt(firstName?: string): string {
  const nameContext = firstName
    ? `You already know the user's preferred name: ${firstName}. Do NOT ask for their name again unless they explicitly correct it.`
    : `You do not know the user's preferred name yet. Ask naturally what they'd like you to call them first. Do not ask for their company domain or website until after you have a preferred name and have called capture_name.`;

  return `You are Arcova in this chat. Match the tone of arcova.app: clear, confident, built for life science companies and the teams who sell into pharma, biotech, CROs, CDMOs, and adjacent markets. Be direct and human, not stiff or overly deferential, and never like a generic support bot. One idea per sentence. Skip stacked buzzwords.

Your job is a short setup so they can use Arcova to find and prioritise the right accounts and contacts, with the context that helps them sell.

${nameContext}

What they are building when one sentence helps: their company profile, then target company profiles, then one full buying group per target company (functions and seniority involved in buying in one profile, not several disconnected "teams" for the same company).

The product shows a fixed welcome in two bubbles (greet plus a short domain ask only) when their name is already known, or right after capture_name succeeds. Follow the thread the client sends you. Do not repeat that welcome unless they clearly ask you to.

If their preferred name is still missing: one short message only, ask what to call them, then call capture_name when you have it.

If they send a clear website or bare domain, call begin_analysis immediately. If they only say they are ready without a URL, one short message: ask for their company domain when they are ready.

If they give a clear preferred name ("call me Emma"), accept it and move on. Do not ask "is that correct?"

Allowed topics: what Arcova does, why you need their name or domain, what this setup enables, how long it takes, what happens next.

Out of scope: if they go off-topic, one short sentence, then back to the next step. No brainstorming, roleplay, or long tangents.

Style: short sentences. No bullet points in spoken replies. No mention of tools, APIs, models, prompts, or backends.

Tool rules: call capture_name as soon as you have a usable preferred name. Call begin_analysis as soon as you have a website or bare domain. Bare domains like arcova.app count.`;
}

function buildNarrationSystemPrompt(): string {
  return `You are Arcova here too: same tone as arcova.app and the main setup chat, concise and practical for life science commercial teams. Messages that start with "[System:" are app instructions, not the user. Follow them exactly.

At most 2 short sentences, no lists. Capable and calm, not salesy. Do not mention tools, APIs, models, prompts, or backends.

Product language when relevant:
- Target company profile = the kinds of companies they sell to.
- Full buying group = one combined profile per target company (functions and seniority involved in buying in one pass, not multiple separate team records).
- After a buying group is saved, next steps are another target company profile or importing contacts. Do not imply several disconnected "teams" for the same company.`;
}

const PHASE_HELP_HINTS: Record<string, string> = {
  company_select:
    'They are choosing which target company profile to define the full buying group for (one combined profile per company).',
  company_type: 'They are choosing the primary type of company they usually sell to.',
  company_size: 'They are selecting typical company headcount bands (can pick several).',
  company_ta: 'They are selecting therapeutic areas (can pick several).',
  company_modality: 'They are selecting modalities (can pick several).',
  company_stage: 'They are selecting typical development stages (can pick several).',
  company_funding: 'They are selecting typical funding stages (can pick several).',
  persona_functions: 'They are selecting functions/teams that belong in one full buying group for this target company profile.',
  persona_seniority: 'They are selecting seniority levels across that full buying group.',
};

function buildPhaseHelpSystemPrompt(phase: string): string {
  const hint = PHASE_HELP_HINTS[phase] ?? 'They are in a structured setup step with chip selectors below.';
  return `You are Arcova. ${hint}

They may ask a quick question. At most 2 short sentences, no lists, no tools. Sound like someone who gets commercial life science, then point them back to the chips. If off-topic, one brief sentence and redirect.

Use "full buying group" for the persona step: one combined profile per target company (functions and seniority), not several separate team records.`;
}

type ConversationMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: Array<{ type: 'text'; text: string }> };

type OnboardingAction =
  | { type: 'capture_name'; first_name: string }
  | { type: 'begin_analysis'; website_url: string };

function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getAssistantText(blocks: Anthropic.ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function buildToolResult(
  toolUse: Extract<Anthropic.ContentBlock, { type: 'tool_use' }>,
  content: string
): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content,
  };
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

    const body = await request.json();
    const { messages, firstName, mode, phase } = body as {
      messages: ConversationMessage[];
      firstName?: string;
      mode?: 'conversation' | 'narration' | 'phase_help';
      phase?: string;
    };

    const resolvedMode = mode ?? 'conversation';

    /** Known name, first load: scripted bubbles only (no model, no delimiter leakage). */
    if (resolvedMode === 'conversation' && firstName?.trim() && messages.length === 0) {
      const trimmed = firstName.trim();
      const segments = buildScriptedOnboardingSegments(trimmed);
      const text = segments.join('\n\n');
      return NextResponse.json({
        role: 'assistant',
        text,
        segments,
        actions: [] as OnboardingAction[],
      });
    }

    const conversation: Anthropic.MessageParam[] =
      messages.length > 0
        ? (messages as Anthropic.MessageParam[])
        : [{ role: 'user', content: 'Please begin the onboarding conversation.' }];

    /** Tool-free modes: internal copy and in-flow questions. Never expose capture_name / begin_analysis here. */
    if (resolvedMode === 'narration' || resolvedMode === 'phase_help') {
      const system =
        resolvedMode === 'narration' ? buildNarrationSystemPrompt() : buildPhaseHelpSystemPrompt(phase ?? '');

      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        system,
        messages: conversation,
      });

      const text = getAssistantText(response.content);
      return NextResponse.json({
        role: 'assistant',
        text,
        actions: [] as OnboardingAction[],
      });
    }

    const actions: OnboardingAction[] = [];
    let finalText = '';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        system: buildSystemPrompt(firstName),
        messages: conversation,
        tools: TOOLS,
      });

      const toolUses = response.content.filter(
        (block): block is Extract<Anthropic.ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use'
      );

      if (toolUses.length === 0) {
        finalText = getAssistantText(response.content);
        break;
      }

      conversation.push({
        role: 'assistant',
        content: response.content,
      });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        if (toolUse.name === 'capture_name') {
          const toolInput = toolUse.input as { first_name?: unknown };
          const firstNameInput =
            typeof toolInput.first_name === 'string' ? toolInput.first_name.trim() : '';

          if (firstNameInput) {
            actions.push({ type: 'capture_name', first_name: firstNameInput });
          }

          toolResults.push(
            buildToolResult(
              toolUse,
              firstNameInput
                ? `Captured the user's preferred name as ${firstNameInput}. Continue the onboarding conversation.`
                : "The user's preferred name was not captured successfully. Ask again."
            )
          );
          continue;
        }

        if (toolUse.name === 'begin_analysis') {
          const toolInput = toolUse.input as { website_url?: unknown };
          const rawWebsite =
            typeof toolInput.website_url === 'string' ? toolInput.website_url : '';
          const websiteUrl = normalizeWebsiteUrl(rawWebsite);

          if (websiteUrl) {
            actions.push({ type: 'begin_analysis', website_url: websiteUrl });
          }

          toolResults.push(
            buildToolResult(
              toolUse,
              websiteUrl
                ? `Captured the website URL ${websiteUrl}. Analysis can begin now. Briefly acknowledge that you're starting the analysis.`
                : 'The website URL was invalid. Ask the user for the company website again.'
            )
          );
        }
      }

      conversation.push({
        role: 'user',
        content: toolResults,
      });

      const onlyCaptureName =
        toolUses.length === 1 &&
        toolUses[0].name === 'capture_name' &&
        actions.some((a) => a.type === 'capture_name' && a.first_name.trim().length > 0);

      if (onlyCaptureName) {
        const captured = actions.find((a): a is Extract<OnboardingAction, { type: 'capture_name' }> => a.type === 'capture_name');
        if (captured?.first_name) {
          const segments = buildScriptedOnboardingSegments(captured.first_name);
          const text = segments.join('\n\n');
          return NextResponse.json({
            role: 'assistant',
            text,
            segments,
            actions,
          });
        }
      }
    }

    return NextResponse.json({
      role: 'assistant',
      text: finalText,
      actions,
    });
  } catch (error) {
    console.error('[onboarding-chat] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
