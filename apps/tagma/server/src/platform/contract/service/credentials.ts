export const GRANT_VARIABLE = 'TAGMA_SESSION_GRANT';

export const GRANT_HEADER = 'x-tagma-grant';

export const SESSION_TOKEN_VARIABLE = 'TAGMA_HARNESS_SESSION';

export const TERMINAL_VARIABLE = 'TAGMA_TERMINAL';

export const TERMINAL_HEADER = 'x-tagma-terminal';

export const CALLER_HEADER = 'x-tagma-caller';

export const ACT_VARIABLE = 'TAGMA_SESSION_ACT';

export const ACT_HEADER = 'x-tagma-act';

export function actValue(runId: string, step: number): string {
  return `${runId}:${step}`;
}

export function parseAct(value: string | undefined): { readonly runId: string; readonly step: number } | null {
  const text = value?.trim();
  if (!text) return null;
  const cut = text.lastIndexOf(':');
  if (cut <= 0) return null;
  const step = Number(text.slice(cut + 1));
  return Number.isSafeInteger(step) && step >= 0 ? { runId: text.slice(0, cut), step } : null;
}

export const ALLOW_VARIABLE = 'TAGMA_ALLOW';

export const OWN_GIT_VARIABLE = 'TAGMA_OWN_GIT';
