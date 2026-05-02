import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';

const client = new Anthropic();

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'confirm_transition',
    description:
      "Call this when the user has clearly and unambiguously expressed that they want to move to a different setup step — e.g. they say they are happy with their profile and want to continue, or they explicitly want to start fresh. Do NOT call this speculatively. When called, a confirmation button appears in the UI alongside your text response. Choose the target that best matches their intent.",
    input_schema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          enum: ['proceed_to_customer_url', 'confirm_own_company', 'resume_continue', 'restart'],
          description: [
            "'proceed_to_customer_url': user wants to move on to entering a target customer company URL.",
            "'confirm_own_company': user is confirming their own company analysis looks right (same as clicking 'Looks right').",
            "'resume_continue': user wants to continue from where they left off (same as the resume continue button).",
            "'restart': user wants to start the whole setup fresh.",
          ].join(' '),
        },
        button_label: {
          type: 'string',
          description: "Short label for the confirmation button shown to the user. Examples: 'Continue to target companies →', 'Yes, looks right →', 'Pick up where I left off →', 'Start fresh →'",
        },
      },
      required: ['target', 'button_label'],
    },
  },
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
      "Call this once you have a website URL or bare domain to analyse. Set analysis_type to 'own_company' when you are collecting the user's own company URL (first-time setup or explicit restart). Set analysis_type to 'target_customer' when the user's own company profile is already set up and you are collecting a target customer or prospect company URL. If the account context shows their company is already stored, always use 'target_customer'.",
    input_schema: {
      type: 'object' as const,
      properties: {
        website_url: {
          type: 'string',
          description: 'The website URL to analyse (e.g. https://acme.com)',
        },
        analysis_type: {
          type: 'string',
          enum: ['own_company', 'target_customer'],
          description: "Use 'own_company' only when collecting the user's own company URL. Use 'target_customer' when collecting a target customer or prospect URL.",
        },
      },
      required: ['website_url', 'analysis_type'],
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

interface AccountContext {
  companyName?: string;
  companyWebsite?: string;
  companyDescription?: string[];
  icps?: Array<{
    name: string;
    companyType: string;
    therapeuticAreas: string[];
    customerTherapeuticAreas: string[];
    companySizes: string[];
    fundingStages: string[];
  }>;
  personas?: Array<{ name: string; functions: string[]; seniority: string[] }>;
}

function buildAccountContextBlock(ctx: AccountContext): string {
  if (!ctx.companyName && (!ctx.icps || ctx.icps.length === 0)) return '';

  const lines: string[] = ['The following data is already stored in this user\'s Arcova account. Use it to answer any questions they have about what\'s saved — do not say you don\'t have access to it.'];

  if (ctx.companyName) {
    lines.push(`\nTheir company: ${ctx.companyName} (${ctx.companyWebsite ?? 'no website recorded'})`);
    if (ctx.companyDescription && ctx.companyDescription.length > 0) {
      lines.push(`Description: ${ctx.companyDescription.slice(0, 2).join(' ')}`);
    }
  }

  if (ctx.icps && ctx.icps.length > 0) {
    lines.push(`\nTarget company profiles (${ctx.icps.length}):`);
    for (const icp of ctx.icps) {
      lines.push(`- "${icp.name}": ${icp.companyType}, own TAs: ${icp.therapeuticAreas.join(', ') || 'none'}, customer-segment TAs: ${icp.customerTherapeuticAreas.join(', ') || 'none'}, sizes: ${icp.companySizes.join(', ') || 'none'}, funding: ${icp.fundingStages.join(', ') || 'none'}`);
    }
  }

  if (ctx.personas && ctx.personas.length > 0) {
    lines.push(`\nBuying groups (${ctx.personas.length}):`);
    for (const p of ctx.personas) {
      lines.push(`- "${p.name}": functions: ${p.functions.join(', ') || 'none'}, seniority: ${p.seniority.join(', ') || 'none'}`);
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(firstName?: string, phase?: string, accountCtx?: AccountContext): string {
  const name = firstName?.trim() || 'the user';
  const accountBlock = accountCtx ? buildAccountContextBlock(accountCtx) : '';

  if (phase === 'customer_url_input') {
    return `You are Arcova. ${firstName ? `The user's name is ${firstName}.` : ''} Their own company profile is already set up. Now build their target company list — ask for the URL of a dream account or a company that looks like their best customer, and tell them you'll profile it. Keep the intro to 1–2 short sentences, conversational.

If they send a clear website or bare domain, call begin_analysis immediately. Bare domains like bioora.com count.

If they send a recognisable company name (e.g. "Natera", "Pfizer", "Charles River"), infer the most likely domain (e.g. natera.com, pfizer.com, criver.com) and call begin_analysis immediately with that domain. Do not ask for confirmation — just proceed.

If they are unsure or ask for help, respond conversationally: help them think of a specific example customer (a company name, a type of company). Ask one short question to guide them.

${accountBlock ? `${accountBlock}\n` : ''}Style: short sentences. One idea per sentence. No bullet points. No mention of tools, APIs, or backends. Never use the words signal or signals when speaking to the user — describe setup in terms of profiles, buying groups, accounts, and contacts instead.`;
  }

  const nameContext = firstName
    ? `You already know the user's preferred name: ${firstName}. Do NOT ask for their name again unless they explicitly correct it.`
    : `You do not know the user's preferred name yet. Ask naturally what they'd like you to call them first. Do not ask for their company domain or website until after you have a preferred name and have called capture_name.`;

  return `You are Arcova in this chat. Match the tone of arcova.app: clear, confident, built for life science companies and the teams who sell into pharma, biotech, CROs, CDMOs, and adjacent markets. Be direct and human, not stiff or overly deferential, and never like a generic support bot. One idea per sentence. Skip stacked buzzwords.

Your job is a short setup so they can use Arcova to find and prioritise the right accounts and contacts, with the context that helps them sell.

${nameContext}

${accountBlock ? `${accountBlock}\n` : ''}What they are building when one sentence helps: their company profile, then target company profiles, then one full buying group per target company (functions and seniority involved in buying in one profile, not several disconnected "teams" for the same company).

The product shows a fixed welcome in two bubbles (greet plus a short domain ask only) when their name is already known, or right after capture_name succeeds. Follow the thread the client sends you. Do not repeat that welcome unless they clearly ask you to.

If their preferred name is still missing: one short message only, ask what to call them, then call capture_name when you have it.

If they send a clear website or bare domain, call begin_analysis immediately. If they only say they are ready without a URL, one short message: ask for their company domain when they are ready.

If they give a clear preferred name ("call me ${name}"), accept it and move on. Do not ask "is that correct?"

If they seem unsure about or do not know their company website: this is fine and common. Ask what their company is called — you can usually work out the domain from the name. Do not treat this as off-topic or keep repeating the URL request. Help them get there with one natural follow-up question.

If what they sent is clearly not a website and they have not expressed any confusion (e.g. they are testing the chat or joking): one friendly sentence acknowledging it, then ask for the company domain or name.

CRITICAL — analysis_type rule: If the account context above shows their company is already stored (companyName is present), their own company profile is done. Do NOT ask for their company URL again. Instead, confirm their profile looks good and ask for a target customer or prospect company URL. When calling begin_analysis in this situation, always set analysis_type to 'target_customer'. Only use analysis_type 'own_company' when you are genuinely collecting their own company URL for the first time (no company in account context, or they explicitly said they want to redo their own profile from scratch).

Allowed topics: what Arcova does, why you need their name or domain, what this setup enables, how long it takes, what happens next. If they ask what data is stored for them, answer using the account data above — be specific and accurate.

Out of scope: if they go on a genuine tangent (brainstorming, roleplay, unrelated topics), one brief sentence, then redirect to the next step.

Style: short sentences. No bullet points in spoken replies. No mention of tools, APIs, models, prompts, or backends. Never use the words signal or signals when speaking to the user — describe setup in terms of profiles, buying groups, accounts, and contacts instead.

Tool rules: call capture_name as soon as you have a usable preferred name. Call begin_analysis as soon as you have a website or bare domain. Bare domains like arcova.app count. Call confirm_transition when the user clearly wants to advance to a different step — e.g. they say their profile is fine and they want to move on, they want to continue from where they left off, or they want to start fresh. Always pair it with a short natural sentence.`;
}

function buildNarrationSystemPrompt(): string {
  return `You are Arcova here too: same tone as arcova.app and the main setup chat, concise and practical for life science commercial teams. Messages that start with "[System:" are app instructions, not the user. Follow them exactly.

At most 2 short sentences, no lists. Capable and calm, not salesy. Do not mention tools, APIs, models, prompts, or backends. Never use the words signal or signals when speaking to the user — describe setup in terms of profiles, buying groups, accounts, and contacts instead.

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

They may ask a quick question. At most 2 short sentences, no lists, no tools. Sound like someone who gets commercial life science, then point them back to the chips. If off-topic, one brief sentence and redirect. Never use the words signal or signals when speaking to the user.

Use "full buying group" for the persona step: one combined profile per target company (functions and seniority), not several separate team records.`;
}

type ConversationMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: Array<{ type: 'text'; text: string }> };

type OnboardingAction =
  | { type: 'capture_name'; first_name: string }
  | { type: 'begin_analysis'; website_url: string; analysis_type: 'own_company' | 'target_customer' }
  | { type: 'confirm_transition'; target: 'proceed_to_customer_url' | 'confirm_own_company' | 'resume_continue' | 'restart'; button_label: string };

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

async function fetchAccountContext(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<AccountContext> {
  try {
    const [analysisResult, icpsResult, personasResult] = await Promise.all([
      supabase
        .from('user_company')
        .select('company_name, website, description')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('icps')
        .select('name, company_type, therapeutic_areas, company_sizes, funding_stages')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('personas')
        .select('name, functions, seniority_levels')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    const ctx: AccountContext = {};

    if (analysisResult.data) {
      ctx.companyName = analysisResult.data.company_name ?? undefined;
      ctx.companyWebsite = analysisResult.data.website ?? undefined;
      ctx.companyDescription = Array.isArray(analysisResult.data.description) ? analysisResult.data.description : undefined;
    }

    if (icpsResult.data && icpsResult.data.length > 0) {
      ctx.icps = icpsResult.data.map((icp) => ({
        name: icp.name ?? '',
        companyType: icp.company_type ?? '',
        therapeuticAreas: Array.isArray(icp.therapeutic_areas) ? icp.therapeutic_areas : [],
        customerTherapeuticAreas: Array.isArray((icp as Record<string, unknown>).customer_therapeutic_areas) ? (icp as Record<string, unknown>).customer_therapeutic_areas as string[] : [],
        companySizes: Array.isArray(icp.company_sizes) ? icp.company_sizes : [],
        fundingStages: Array.isArray(icp.funding_stages) ? icp.funding_stages : [],
      }));
    }

    if (personasResult.data && personasResult.data.length > 0) {
      ctx.personas = personasResult.data.map((p) => {
        const rawFunctions = Array.isArray(p.functions) ? p.functions : [];
        const functionNames = rawFunctions.map((f: unknown) => {
          if (typeof f === 'string') {
            try { return (JSON.parse(f) as { name?: string }).name ?? f; } catch { return f; }
          }
          if (typeof f === 'object' && f !== null && 'name' in f) return String((f as { name: unknown }).name);
          return String(f);
        });
        return {
          name: p.name ?? '',
          functions: functionNames,
          seniority: Array.isArray(p.seniority_levels) ? p.seniority_levels : [],
        };
      });
    }

    return ctx;
  } catch {
    return {};
  }
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
    const accountCtx = await fetchAccountContext(supabase, user.id);

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
        system: buildSystemPrompt(firstName, phase, accountCtx),
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

      // Capture any text the model included alongside tool calls
      const textAlongside = getAssistantText(response.content);
      if (textAlongside && !finalText) finalText = textAlongside;

      conversation.push({
        role: 'assistant',
        content: response.content,
      });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        if (toolUse.name === 'confirm_transition') {
          const toolInput = toolUse.input as { target?: unknown; button_label?: unknown };
          const target = typeof toolInput.target === 'string' ? toolInput.target : '';
          const buttonLabel = typeof toolInput.button_label === 'string' ? toolInput.button_label : 'Continue →';

          if (target) {
            actions.push({
              type: 'confirm_transition',
              target: target as 'proceed_to_customer_url' | 'confirm_own_company' | 'resume_continue' | 'restart',
              button_label: buttonLabel,
            });
          }

          toolResults.push(
            buildToolResult(
              toolUse,
              'Done. Now write one short, warm, conversational sentence about what happens next — as if you are just talking to them. Do NOT mention "confirm", "button", "click", or any UI element. Sound natural, not robotic.',
            )
          );
          continue;
        }

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
          const toolInput = toolUse.input as { website_url?: unknown; analysis_type?: unknown };
          const rawWebsite =
            typeof toolInput.website_url === 'string' ? toolInput.website_url : '';
          const websiteUrl = normalizeWebsiteUrl(rawWebsite);
          const analysisType: 'own_company' | 'target_customer' =
            toolInput.analysis_type === 'target_customer' ? 'target_customer' : 'own_company';

          if (websiteUrl) {
            actions.push({ type: 'begin_analysis', website_url: websiteUrl, analysis_type: analysisType });
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
