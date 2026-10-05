interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface Env {
  AI: AiBinding;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

type AssistantMode = 'draft_event' | 'polish_description';

type AssistantRequest = {
  mode: AssistantMode;
  text: string;
};

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_INPUT_CHARS = 12_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const eventDraftSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    public_description: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    daily_start_time: { type: 'string' },
    daily_end_time: { type: 'string' },
    camping_status: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    schedule_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          date: { type: 'string' },
          time: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['label', 'date', 'time', 'notes'],
      },
    },
    rulesets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string' },
          ruleset: { type: 'string' },
        },
        required: ['scope', 'ruleset'],
      },
    },
    competitions: {
      type: 'array',
      items: { type: 'string' },
    },
    requirements: {
      type: 'array',
      items: { type: 'string' },
    },
    missing_information: {
      type: 'array',
      items: { type: 'string' },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'name',
    'public_description',
    'start_date',
    'end_date',
    'daily_start_time',
    'daily_end_time',
    'camping_status',
    'schedule_items',
    'rulesets',
    'competitions',
    'requirements',
    'missing_information',
    'warnings',
  ],
};

const polishSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    polished_text: { type: 'string' },
    changes_made: {
      type: 'array',
      items: { type: 'string' },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['polished_text', 'changes_made', 'warnings'],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function authenticate(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
    },
  });

  if (!response.ok) return null;

  const user = await response.json() as { id?: string };
  return user.id ?? null;
}

function getSchema(mode: AssistantMode) {
  return mode === 'draft_event' ? eventDraftSchema : polishSchema;
}

function systemPrompt(mode: AssistantMode): string {
  if (mode === 'polish_description') {
    return [
      'You are the BuhurtOS event writing assistant.',
      'Correct spelling, grammar, punctuation, organization and readability while preserving every factual detail.',
      'Do not invent dates, times, rules, requirements, categories, fees, locations, contacts, eligibility rules or policies.',
      'If the source is ambiguous or contradictory, preserve the safest factual wording and add a warning.',
      'Return only the requested structured JSON.',
    ].join(' ');
  }

  return [
    'You are the BuhurtOS event setup assistant for armored combat and buhurt events.',
    'Extract event facts from messy organizer notes and write a clear public description.',
    'Never invent factual event information.',
    'When a fact is missing, use an empty string where applicable and add a plain-language item to missing_information.',
    'Do not convert assumptions into facts.',
    'Preserve distinctions between organizations, rulesets, insurance requirements, fighter eligibility, volunteer requirements, team rules and competition-specific rules.',
    'For dates use YYYY-MM-DD only when the year is explicitly known from the supplied text.',
    'For times use HH:MM in 24-hour format only when the source gives a time.',
    'Return only the requested structured JSON.',
  ].join(' ');
}

async function runAssistant(env: Env, body: AssistantRequest): Promise<unknown> {
  const schema = getSchema(body.mode);

  const result = await env.AI.run(MODEL, {
    messages: [
      { role: 'system', content: systemPrompt(body.mode) },
      { role: 'user', content: body.text },
    ],
    temperature: 0.2,
    max_tokens: 2200,
    response_format: {
      type: 'json_schema',
      json_schema: schema,
    },
  }) as { response?: unknown } | unknown;

  if (result && typeof result === 'object' && 'response' in result) {
    const response = (result as { response?: unknown }).response;
    if (typeof response === 'string') {
      try {
        return JSON.parse(response);
      } catch {
        throw new Error('Workers AI returned invalid structured JSON.');
      }
    }
    return response;
  }

  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        service: 'buhurtos-ai-event-assistant',
        model: MODEL,
      });
    }

    if (request.method !== 'POST' || url.pathname !== '/v1/event-assistant') {
      return json({ error: 'Not found' }, 404);
    }

    const userId = await authenticate(request, env);
    if (!userId) {
      return json({ error: 'Sign in to BuhurtOS before using the AI event assistant.' }, 401);
    }

    let body: AssistantRequest;
    try {
      body = await request.json() as AssistantRequest;
    } catch {
      return json({ error: 'Request body must be valid JSON.' }, 400);
    }

    if (body.mode !== 'draft_event' && body.mode !== 'polish_description') {
      return json({ error: 'Unsupported assistant mode.' }, 400);
    }

    if (typeof body.text !== 'string' || !body.text.trim()) {
      return json({ error: 'Event text is required.' }, 400);
    }

    if (body.text.length > MAX_INPUT_CHARS) {
      return json({ error: `Event text is too long. Maximum ${MAX_INPUT_CHARS} characters.` }, 413);
    }

    try {
      const result = await runAssistant(env, {
        mode: body.mode,
        text: body.text.trim(),
      });

      return json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI request failed.';
      console.error('event-assistant failure', { userId, message });
      return json({
        error: 'The AI event assistant could not complete this request.',
        detail: message,
      }, 502);
    }
  },
};
