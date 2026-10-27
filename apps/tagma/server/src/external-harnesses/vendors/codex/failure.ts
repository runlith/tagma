import { familyRetries, type WireFailureFamily } from '@runlith/llm/schema/errors';
import type { TransportFailure } from '@runlith/agent/transcript/entries';

type Class = { readonly type: string; readonly family: WireFailureFamily };

const RATE_LIMIT: Class = { type: 'RateLimit', family: 'rate-limit' };

const CLASSES: Readonly<Record<string, Class>> = {
  usage_limit_exceeded: RATE_LIMIT,
  rate_limit_exceeded: RATE_LIMIT,
  server_overloaded: { type: 'ProviderInternal', family: 'overloaded' },
};

const named = (info: unknown): string | null => {
  if (typeof info === 'string') return info;
  if (typeof info !== 'object' || info === null || Array.isArray(info)) return null;
  const keys = Object.keys(info);
  return keys.length === 1 ? keys[0]! : null;
};

export const codexFailureOf = (info: unknown): TransportFailure | null => {
  const name = named(info);
  const known = name === null ? undefined : CLASSES[name];
  if (known === undefined) return null;
  return {
    stage: 'codex.turn',
    type: known.type,
    retryable: familyRetries(known.family),
    modelStarted: null,
    reason: { family: known.family },
  };
};
