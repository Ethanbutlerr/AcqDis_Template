import { supabase } from '@/lib/supabase/client';

export interface AutomationTriggerPayload {
  trigger_type: string;
  company_id: string;
  record_id: string;
  record_type: string;
  metadata?: Record<string, unknown>;
}

export async function triggerAutomation(payload: AutomationTriggerPayload): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) throw new Error('Automation service is not configured.');

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('Your session expired. Sign in again before starting automations.');
  }

  const response = await fetch(`${baseUrl}/functions/v1/automation-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ action: 'trigger', ...payload }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: string };
      detail = body.error ? ` ${body.error}` : '';
    } catch {
      // The status still provides an actionable failure when the response is not JSON.
    }
    throw new Error(`Automation could not be started (${response.status}).${detail}`);
  }
}
