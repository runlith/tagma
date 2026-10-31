import { sha256 } from '@runlith/utils/sha256';
import type { RunEndStatus } from '../transcript/live';

export type CallKey = { readonly namespace: string; readonly id: string };

export type Evidence =
  | { readonly call: CallKey }
  | { readonly envelope: CallKey }
  | { readonly run: string; readonly seq: number }
  | { readonly started: CallKey }
  | { readonly runEnd: string; readonly status: RunEndStatus }
  | { readonly inboxItem: string; readonly run: string | null }
  | { readonly settlement: string; readonly effects: readonly string[] }
  | { readonly owned: CallKey }
  | { readonly decidedBy: string };

export type Keyed = { readonly evidence: Evidence; readonly digest: string };

export type TransitionOutcome<A> =
  | { readonly committed: A }
  | { readonly replayed: A }
  | { readonly refused: A }
  | { readonly spent: { readonly at: Date | 'before-epoch' } }
  | { readonly stalled: 'none' }
  | { readonly stalled: 'uncertain'; readonly key: Keyed };

export type KeyedRequest = { readonly key: string; readonly deadline: Date };

export type KeyedSpent = { readonly status: 'spent'; readonly at: Date | 'before-epoch' };

export type CallParts = { readonly operation: string; readonly actor: string; readonly key: string };

export type CallerKey = { readonly actor: string; readonly key: string };

export function callKey(parts: CallParts): CallKey {
  if (parts.operation.includes(':')) throw new Error(`An operation name keys a call and holds no colon: ${parts.operation}.`);
  return { namespace: `${parts.operation}:${parts.actor}`, id: parts.key };
}

export const REPORT_OPERATION = 'report';

export const REPORT_WINDOW = 64;

export function reportKey(runId: string, mark: string): CallKey {
  return callKey({ operation: REPORT_OPERATION, actor: runId, key: mark });
}

//! Kept past the run's end, unlike report keys: spend can arrive after the core ended the run.
export function chargeKey(runId: string, mark: string): CallKey {
  return callKey({ operation: 'charge', actor: runId, key: mark });
}

export function startedKey(threadId: string, key: string): CallKey {
  return callKey({ operation: 'start', actor: threadId, key });
}

export type AdmitCaller =
  | { readonly kind: 'reader' }
  | { readonly kind: 'thread'; readonly threadId: string }
  | { readonly kind: 'external'; readonly name: string };

export type ThreadInputOptions = { readonly key?: string; readonly caller?: AdmitCaller };

export function callerActor(caller: AdmitCaller): string {
  switch (caller.kind) {
    case 'reader':
      return 'reader';
    case 'thread':
      return `thread.${caller.threadId}`;
    case 'external':
      return `external.${caller.name}`;
  }
}

export const INPUT_OPERATION = 'input';

const INPUT_PREFIX = `${INPUT_OPERATION}:`;

export function inputItemId(caller: AdmitCaller, key: string): string {
  return `${INPUT_PREFIX}${encodeURIComponent(callerActor(caller))}:${encodeURIComponent(key)}`;
}

export function inputEvidence(caller: AdmitCaller, key: string): Evidence {
  return { call: callKey({ operation: INPUT_OPERATION, actor: callerActor(caller), key }) };
}

export type InputAddress = { readonly key: string; readonly evidence: Evidence };

export function inputAddressOf(itemId: string): InputAddress | null {
  if (!itemId.startsWith(INPUT_PREFIX)) return null;
  const cut = itemId.indexOf(':', INPUT_PREFIX.length);
  if (cut < 0) return null;
  const actor = decodeURIComponent(itemId.slice(INPUT_PREFIX.length, cut));
  const key = decodeURIComponent(itemId.slice(cut + 1));
  return { key, evidence: { call: callKey({ operation: INPUT_OPERATION, actor, key }) } };
}

export function callParts(key: CallKey): CallParts {
  const cut = key.namespace.indexOf(':');
  return cut < 0
    ? { operation: key.namespace, actor: '', key: key.id }
    : { operation: key.namespace.slice(0, cut), actor: key.namespace.slice(cut + 1), key: key.id };
}

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mintedBefore(id: string, epoch: Date | null): boolean {
  if (epoch === null || !UUIDV7.test(id)) return false;
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16) < epoch.getTime();
}

export function evidenceKey(evidence: Evidence): string {
  if ('call' in evidence) return `call:${evidence.call.namespace}:${evidence.call.id}`;
  if ('envelope' in evidence) return `envelope:${evidence.envelope.namespace}:${evidence.envelope.id}`;
  if ('owned' in evidence) return `owned:${evidence.owned.namespace}:${evidence.owned.id}`;
  if ('seq' in evidence) return `run:${evidence.run}:${evidence.seq}`;
  if ('started' in evidence) return `started:${evidence.started.namespace}:${evidence.started.id}`;
  if ('runEnd' in evidence) return `end:${evidence.runEnd}`;
  if ('inboxItem' in evidence) return `inbox:${evidence.inboxItem}`;
  if ('decidedBy' in evidence) return `decided:${evidence.decidedBy}`;
  return `settlement:${evidence.settlement}`;
}

export function actDigest(input: unknown): string {
  return sha256().update(JSON.stringify(input)).digest('base64url');
}
