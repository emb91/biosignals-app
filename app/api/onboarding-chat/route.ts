import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { completeLlm } from '@/lib/llm-client';
import { createClient } from '@/lib/supabase-server';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import {
  buildSetupCustomerUrlPhaseSystemPrompt,
  buildSetupMainChatSystemPrompt,
  buildSetupNarrationSystemPrompt,
  buildSetupPhaseHelpSystemPrompt,
} from '@/lib/prompts/agent-voice';

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
      "Call this once you have a website URL or bare domain to analyse. Set analysis_type to 'own_company' when you are collecting the user's own seller company URL (first-time setup, restart, or they are on the opening setup screen asking for their company's website). Set analysis_type to 'target_customer' only when the conversation is in the target-customer step and they give a prospect company URL after their own company is set for this flow. If they describe a target segment (company type, size band, geography) without naming a company, infer one well-known real company's primary domain and pass it as website_url with analysis_type target_customer, unless you are too unsure (then ask one short question instead). If their company row exists in account context but they are on the opening screen or clearly re-entering their seller site, still use 'own_company'.",
    input_schema: {
      type: 'object' as const,
      properties: {
        website_url: {
          type: 'string',
          description:
            'The website URL to analyse (e.g. https://acme.com). May be a domain you inferred from a company name or from a described target segment when you chose one well-known exemplar company.',
        },
        analysis_type: {
          type: 'string',
          enum: ['own_company', 'target_customer'],
          description:
            "Use 'own_company' only when collecting the user's own company URL. Use 'target_customer' when they gave a target prospect URL or name, or when you inferred a well-known exemplar company's domain from how they described their target segment.",
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
    return buildSetupCustomerUrlPhaseSystemPrompt({
      firstName,
      accountBlock,
    });
  }

  const nameContext = firstName?.trim()
    ? `You already know the user's preferred name: ${firstName.trim()}. Do NOT ask for their name again unless they explicitly correct it.`
    : `You do not know the user's preferred name yet. Ask naturally what they'd like you to call them first. Do not ask for their company domain or website until after you have a preferred name and have called capture_name.`;

  return buildSetupMainChatSystemPrompt({
    nameContext,
    accountBlock,
    callMeExampleLabel: name,
  });
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

/** Serialize a chat history into a single prompt for the provider-routing llm-client. */
function flattenConversationToPrompt(msgs: Anthropic.MessageParam[]): string {
  const renderContent = (content: Anthropic.MessageParam['content']): string => {
    if (typeof content === 'string') return content;
    return content
      .map((block) =>
        block && typeof block === 'object' && 'type' in block && block.type === 'text' && typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : '',
      )
      .filter(Boolean)
      .join('\n');
  };

  if (msgs.length <= 1) return renderContent(msgs[0]?.content ?? '');

  const prior = msgs.slice(0, -1);
  const last = msgs[msgs.length - 1];
  return [
    'Previous conversation:',
    ...prior.map((m) => `${m.role}: ${renderContent(m.content)}`),
    '',
    `Current message: ${renderContent(last.content)}`,
  ].join('\n');
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

// ── Tool-turn with OpenRouter fallback ───────────────────────────────────────
// The conversation loop needs tool calling, which lib/llm-client doesn't
// support — so this route carries its own fallback: on an Anthropic failure
// (credit outage, 5xx) the same turn is replayed through OpenRouter's
// OpenAI-compatible tools API against the same Claude model, and the response
// is converted back into Anthropic content blocks so the loop never knows.

const TOOL_TURN_MODEL_ANTHROPIC = 'claude-haiku-4-5';
const TOOL_TURN_MODEL_OPENROUTER = 'anthropic/claude-haiku-4-5';

type ToolTurn = {
  content: Anthropic.ContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
  provider: 'anthropic' | 'openrouter';
  model: string;
};

function toOpenAiMessages(system: string, messages: Anthropic.MessageParam[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }
    const texts: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    const toolResults: Array<{ id: string; content: string }> = [];
    for (const block of msg.content) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      } else if (block.type === 'tool_result') {
        toolResults.push({
          id: block.tool_use_id,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
        });
      }
    }
    if (msg.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: texts.join('\n') || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // Anthropic puts tool_result blocks in a user turn; OpenAI wants role:'tool' messages.
      for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.id, content: tr.content });
      if (texts.length > 0) out.push({ role: 'user', content: texts.join('\n') });
      if (toolResults.length === 0 && texts.length === 0) out.push({ role: 'user', content: '' });
    }
  }
  return out;
}

async function createToolTurnViaOpenRouter(params: {
  system: string;
  messages: Anthropic.MessageParam[];
}): Promise<ToolTurn> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TOOL_TURN_MODEL_OPENROUTER,
      max_tokens: 256,
      messages: toOpenAiMessages(params.system, params.messages),
      tools: TOOLS.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter tool turn failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  const content: Anthropic.ContentBlock[] = [];
  if (message?.content) {
    content.push({ type: 'text', text: message.content, citations: null } as Anthropic.ContentBlock);
  }
  for (const call of message?.tool_calls ?? []) {
    if (!call.function?.name) continue;
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      /* leave as empty input; the loop's validators handle it */
    }
    content.push({
      type: 'tool_use',
      id: call.id || `or_${Math.random().toString(36).slice(2)}`,
      name: call.function.name,
      input,
    } as Anthropic.ContentBlock);
  }
  return {
    content,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
    provider: 'openrouter',
    model: TOOL_TURN_MODEL_OPENROUTER,
  };
}

async function createToolTurn(params: { system: string; messages: Anthropic.MessageParam[] }): Promise<ToolTurn> {
  try {
    const response = await client.messages.create({
      model: TOOL_TURN_MODEL_ANTHROPIC,
      max_tokens: 256,
      system: params.system,
      messages: params.messages,
      tools: TOOLS,
    });
    return {
      content: response.content,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      provider: 'anthropic',
      model: TOOL_TURN_MODEL_ANTHROPIC,
    };
  } catch (error) {
    if (!process.env.OPENROUTER_API_KEY) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[onboarding-chat] Anthropic tool turn failed, falling back to OpenRouter: ${msg.slice(0, 200)}`);
    return createToolTurnViaOpenRouter(params);
  }
}

async function fetchAccountContext(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<AccountContext> {
  try {
    const orgId = await orgIdForUser(supabase, userId);
    const [analysisResult, icpsResult, personasResult] = await Promise.all([
      supabase
        .from('user_company')
        .select('company_name, website, description')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      scopeIcpsToUser(
        supabase
          .from('icps')
          .select('name, company_type, therapeutic_areas, company_sizes, funding_stages'),
        orgId,
        userId,
      ).order('created_at', { ascending: false }),
      // personas have no scope column; show the org's buying teams (fallback to own).
      (orgId
        ? supabase.from('personas').select('name, functions, seniority_levels').eq('org_id', orgId)
        : supabase.from('personas').select('name, functions, seniority_levels').eq('user_id', userId)
      ).order('created_at', { ascending: false }),
    ]);

    const ctx: AccountContext = {};

    if (analysisResult.data) {
      ctx.companyName = analysisResult.data.company_name ?? undefined;
      ctx.companyWebsite = analysisResult.data.website ?? undefined;
      ctx.companyDescription = Array.isArray(analysisResult.data.description) ? analysisResult.data.description : undefined;
    }

    if (icpsResult.data && icpsResult.data.length > 0) {
      ctx.icps = (icpsResult.data as Array<Record<string, unknown> & {
        name?: string | null; company_type?: string | null; therapeutic_areas?: unknown;
        company_sizes?: unknown; funding_stages?: unknown;
      }>).map((icp) => ({
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
        resolvedMode === 'narration' ? buildSetupNarrationSystemPrompt() : buildSetupPhaseHelpSystemPrompt(phase ?? '');

      const completion = await completeLlm({
        feature: 'onboarding_chat',
        prompt: flattenConversationToPrompt(conversation),
        system,
        maxTokens: 512,
      });
      await recordLlmUsageEvent({
        userId: user.id,
        userEmail: user.email,
        provider: completion.provider,
        feature: resolvedMode === 'narration' ? 'onboarding_narration' : 'onboarding_phase_help',
        route: '/api/onboarding-chat',
        model: completion.model,
        usage: completion.usage,
        metadata: {
          mode: resolvedMode,
          phase: phase ?? null,
          message_count: conversation.length,
        },
      });

      const text = completion.text;
      return NextResponse.json({
        role: 'assistant',
        text,
        actions: [] as OnboardingAction[],
      });
    }

    const actions: OnboardingAction[] = [];
    let finalText = '';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await createToolTurn({
        system: buildSystemPrompt(firstName, phase, accountCtx),
        messages: conversation,
      });
      await recordLlmUsageEvent({
        userId: user.id,
        userEmail: user.email,
        provider: response.provider,
        feature: 'onboarding_chat',
        route: '/api/onboarding-chat',
        model: response.model,
        usage: response.usage,
        metadata: {
          mode: resolvedMode,
          phase: phase ?? null,
          attempt: attempt + 1,
          message_count: conversation.length,
          tool_count: response.content.filter((block) => block.type === 'tool_use').length,
        },
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
