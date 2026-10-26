import { supabase } from './supabase';

export type AiEventAssistantMode = 'draft_event' | 'polish_description';

export type AiEventDraft = {
  name: string;
  public_description: string;
  start_date: string;
  end_date: string;
  daily_start_time: string;
  daily_end_time: string;
  camping_status: 'yes' | 'no' | 'unknown';
  schedule_items: Array<{
    label: string;
    date: string;
    time: string;
    notes: string;
  }>;
  rulesets: Array<{
    scope: string;
    ruleset: string;
  }>;
  competitions: string[];
  requirements: string[];
  missing_information: string[];
  warnings: string[];
};

export type AiPolishedDescription = {
  polished_text: string;
  changes_made: string[];
  warnings: string[];
};

const workerUrl = (import.meta.env.VITE_AI_WORKER_URL as string | undefined)?.replace(/\/$/, '');

export async function runAiEventAssistant(
  mode: 'draft_event',
  text: string,
): Promise<AiEventDraft>;
export async function runAiEventAssistant(
  mode: 'polish_description',
  text: string,
): Promise<AiPolishedDescription>;
export async function runAiEventAssistant(
  mode: AiEventAssistantMode,
  text: string,
): Promise<AiEventDraft | AiPolishedDescription> {
  if (!workerUrl) {
    throw new Error('AI Event Assistant is not configured for this deployment.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error('Sign in to BuhurtOS before using the AI Event Assistant.');
  }

  const response = await fetch(`${workerUrl}/v1/event-assistant`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode, text }),
  });

  const payload = await response.json() as {
    ok?: boolean;
    result?: AiEventDraft | AiPolishedDescription;
    error?: string;
    detail?: string;
  };

  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.error ?? payload.detail ?? 'AI Event Assistant request failed.');
  }

  return payload.result;
}
