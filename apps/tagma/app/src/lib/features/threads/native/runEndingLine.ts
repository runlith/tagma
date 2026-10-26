import type { ThreadFailureDiagnostics } from '@runlith/agent/transcript/entries';
import type { ChatRunEnding } from '@runlith/chat-ui/session/FeedVerdicts';

import type { UsageNeed } from '$lib/features/providers/accounts/status.js';
import { providerName, type ServedModels } from '$lib/features/providers/served.js';
import { resetText } from '$lib/features/providers/usage/windows.js';

export type RunEndingLine = {
  tone: 'failure' | 'interrupted';
  text: string;
  detail: string | null;
};

type FailureSaid = Pick<ThreadFailureDiagnostics, 'provider' | 'reason'>;

const UNREACHED = new Set(['dns', 'tls', 'reset', 'connect-timeout', 'unknown']);

const FAMILY_WORDS: Readonly<Record<string, (provider: string) => string>> = {
  'rate-limit': (provider) => `${provider} is rate-limiting this account`,
  quota: (provider) => `${provider} is out of quota`,
  overloaded: (provider) => `${provider} is overloaded`,
  refused: (provider) => `${provider} refused the request`,
  'invalid-request': (provider) => `${provider} refused the request`,
  'content-policy': (provider) => `${provider} refused on content policy`,
  'no-route': (provider) => `${provider} has no route for this model`,
  'torn-stream': (provider) => `${provider} closed the stream`,
  'socket-closed': (provider) => `${provider} closed the stream`,
  'clean-eof-no-finish': (provider) => `${provider} ended the answer early`,
  'non-json-answer': (provider) => `${provider} answered with something unreadable`,
  'invalid-output': (provider) => `${provider} answered with something unreadable`,
  'blank-error': (provider) => `${provider} answered with a blank error`,
  stalled: (provider) => `${provider} went silent`,
};

const keyed = (models: ServedModels, provider: string | null): boolean =>
  provider !== null && models.registered(provider) && models.named(provider).auth === 'api-key';

export function failureNeed(models: ServedModels, failure: FailureSaid | null | undefined): UsageNeed | null {
  if (failure?.reason?.family !== 'auth') return null;
  return keyed(models, failure.provider) ? 'new-key' : 'sign-in';
}

export function failureTitle(models: ServedModels, failure: FailureSaid | null | undefined): string | null {
  const family = failure?.reason?.family;
  if (failure === null || failure === undefined || family === undefined) return null;
  const provider = failure.provider;
  const named = provider === null ? 'The provider' : providerName(models, provider);
  if (UNREACHED.has(family)) return `Couldn't reach ${provider === null ? 'the provider' : named}`;
  if (family !== 'auth') return (FAMILY_WORDS[family] ?? ((name: string) => `${name} failed: ${family}`))(named);
  const key = keyed(models, provider);
  switch (failure.reason?.kind) {
    case 'expired':
      return `${named} ${key ? 'API key' : 'sign-in'} has expired`;
    case 'missing':
      return key ? `${named} has no API key` : `${named} is not signed in`;
    case 'insufficient-permissions':
      return `${named} ${key ? 'API key' : 'account'} lacks access`;
    default:
      return `${named} did not accept the ${key ? 'API key' : 'sign-in'}`;
  }
}

const CUT_WORDS = 'This work stopped before it was finished.';

export function runEndingLine(models: ServedModels, ending: ChatRunEnding, now: number): RunEndingLine {
  if (ending.kind === 'cut') {
    return { tone: 'interrupted', text: ending.words ?? CUT_WORDS, detail: null };
  }
  const failure = ending.failure;
  const text =
    failureTitle(models, failure === null ? null : { ...failure, provider: failure.provider ?? ending.provider }) ??
    `Run failed — ${ending.words ?? failure?.type ?? 'the run broke before finishing'}`;
  const repeats = failure?.retryable === false ? 'the same request fails the same way' : null;
  return { tone: 'failure', text, detail: resetDetail(ending, now) ?? repeats };
}

export function failedRowDetail(
  models: ServedModels,
  failure: (FailureSaid & { retryable?: boolean | null }) | null | undefined,
  failureReason: string | null,
): string {
  const what = failureTitle(models, failure) ?? (failureReason || 'run failed');
  return `${what} · ${failure?.retryable === false ? 'fails again as is' : 'can continue'}`;
}

function resetDetail(ending: ChatRunEnding, now: number): string | null {
  const wait = ending.failure?.rateLimit?.retryAfterMs;
  if (wait === undefined || ending.finishedAt === null) return null;
  const finished = Date.parse(ending.finishedAt);
  if (Number.isNaN(finished)) return null;
  const remaining = resetText((finished + wait) / 1000, now);
  return remaining === 'now' ? 'the window should be open' : `resets in ${remaining}`;
}
