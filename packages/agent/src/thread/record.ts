import { Data, Schema } from 'effect';
import { CALL_ENVELOPE_MS } from '../agent/callProgress';
import type { ThreadAuthority, ThreadHostBinding } from './rows';
import type { ThreadBornOf } from '../protocol/birth';
import type { ThreadStorageFailed } from './persisted';

export type ThreadModelSelection = {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string | null;
};

export type ThreadForkCut =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'turns'; readonly turns: number }
  | { readonly kind: 'before'; readonly runId: string };

export function forkCutLabel(cut: ThreadForkCut): string {
  if (cut.kind === 'turns') return `turns:${cut.turns}`;
  return cut.kind === 'before' ? `before:${cut.runId}` : cut.kind;
}

export const NATIVE_HARNESS = 'native';

export type ThreadTarget = { readonly threadId: string; readonly projectId?: number };

export function threadTarget(thread: ThreadRecord): ThreadTarget {
  return { threadId: thread.id, ...(thread.projectId === undefined ? {} : { projectId: thread.projectId }) };
}

export type ThreadRecord = {
  readonly id: string;
  readonly projectId?: number;
  readonly principal: string;
  readonly agentId: string;
  readonly typeId: string | null;
  readonly name: string | null;
  readonly spawnRootId: string;
  readonly parentThreadId: string | null;
  readonly spawnedByRunId: string | null;
  readonly bornOf: ThreadBornOf | null;
  readonly createdBy: string | null;
  readonly harness: string;
  readonly host: ThreadHostBinding | null;
  readonly authority: ThreadAuthority;
  readonly plain: boolean;
  readonly budgetTokens: number | null;
  readonly capabilities: TransportCapabilities;
  readonly model: ThreadModelSelection | null;
  readonly profile: string | null;
};

export type CurrentRun = {
  readonly runId: string;
  readonly life: 'working' | 'awaiting';
  readonly askPrompt: string | null;
  readonly since: Date;
  readonly stalledSince: Date | null;
};

export class ThreadRecordUnreadable extends Data.TaggedError('ThreadRecordUnreadable')<{
  readonly threadId: string;
  readonly cause: unknown;
}> {}

export type ThreadReadFailure = ThreadStorageFailed | ThreadRecordUnreadable;

export const transportBindingSchema = Schema.Struct({
  adapter: Schema.String.check(Schema.isMinLength(1)),
  profile: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
});
export type TransportBinding = typeof transportBindingSchema.Type;

export const transportWebSchema = Schema.Literals(['vendor', 'none']);
export type TransportWeb = typeof transportWebSchema.Type;

export const transportCopySchema = Schema.Literals(['vendor', 'record', 'none']);
export type TransportCopy = typeof transportCopySchema.Type;

export const transportCopiesSchema = Schema.Struct({ whole: transportCopySchema, point: transportCopySchema });
export type TransportCopies = typeof transportCopiesSchema.Type;

export const transportCapabilitiesSchema = Schema.Struct({
  messaging: Schema.Boolean,
  judgedModel: Schema.Boolean,
  steer: Schema.Literals(['step', 'none']),
  withdraw: Schema.Boolean,
  history: Schema.Literals(['journal', 'session', 'none']),
  copies: Schema.optional(transportCopiesSchema),
  compaction: Schema.Literals(['core', 'session', 'foreign', 'vendor', 'none']),
  toolCatalog: Schema.optional(Schema.Literals(['turn', 'dispatch'])),
  modelMove: Schema.Literals(['live', 'relaunch', 'pinned']),
  openings: Schema.Literals(['core', 'core-and-observed']),
  pictures: Schema.Boolean,
  web: transportWebSchema,
  law: Schema.NullOr(Schema.Literals(['every-call', 'asked-calls'])),
  touch: Schema.NullOr(Schema.Literals(['reads-and-writes', 'writes'])),
  authorship: Schema.NullOr(Schema.Literals(['recorded', 'observed'])),
  callEnvelopeMs: Schema.NullOr(Schema.Number),
  screen: Schema.Boolean,
  continue: Schema.Boolean,
  feed: Schema.Literals(['full', 'turns']),
  usage: Schema.Literals(['measured', 'partial', 'none']),
  aside: Schema.Literals(['request', 'session', 'none']),
});
export type TransportCapabilities = typeof transportCapabilitiesSchema.Type;

const CANNOT_ACTS = {
  history: 'take a turn out of its conversation or branch it',
  'copies.whole': 'copy its whole conversation into a new thread',
  'copies.point': 'cut its conversation before a turn',
  compaction: 'compact its context',
  continue: 'continue a run that has no waiting words',
} as const;

export type TransportCapabilityName = keyof typeof CANNOT_ACTS;

export type HistorySide = keyof TransportCopies;

export const historyCannot = (capabilities: TransportCapabilities, side: HistorySide): TransportCapabilityName | null =>
  capabilities.history === 'none' ? 'history' : capabilities.copies?.[side] === 'none' ? `copies.${side}` : null;

export const forkSide = (cut: ThreadForkCut): HistorySide | null => (cut.kind === 'all' ? 'whole' : cut.kind === 'none' ? null : 'point');

export const transportCannotReason = (capability: TransportCapabilityName, adapter: string): string =>
  `The ${adapter} transport of this thread cannot ${CANNOT_ACTS[capability]}: it declares no \`${capability}\` capability.`;

export const TRANSPORT_CANNOT_WAYS = [
  'read the thread: its capabilities name what its transport takes',
  'send words to the thread, or start a thread whose transport declares the capability',
] as const;

export class TransportCannotError extends Data.TaggedError('TransportCannot')<{
  readonly threadId: string;
  readonly capability: TransportCapabilityName;
  readonly adapter: string;
  readonly reason?: string;
}> {
  override get message(): string {
    return this.reason ?? transportCannotReason(this.capability, this.adapter);
  }
}

export const NATIVE_BINDING: TransportBinding = { adapter: 'native', profile: null, agent: null };

export const NATIVE_CAPABILITIES: TransportCapabilities = {
  messaging: true,
  judgedModel: true,
  steer: 'step',
  withdraw: true,
  history: 'journal',
  compaction: 'core',
  modelMove: 'live',
  openings: 'core',
  pictures: true,
  web: 'none',
  law: 'every-call',
  touch: 'reads-and-writes',
  authorship: 'recorded',
  callEnvelopeMs: CALL_ENVELOPE_MS,
  screen: false,
  continue: true,
  feed: 'full',
  usage: 'measured',
  aside: 'request',
};

//! A stored binding that does not read names this adapter, which no transport registers.
export const UNREAD_BINDING: TransportBinding = { adapter: 'unreadable', profile: null, agent: null };

export const UNREAD_CAPABILITIES: TransportCapabilities = {
  messaging: false,
  judgedModel: false,
  steer: 'none',
  withdraw: false,
  history: 'none',
  copies: { whole: 'none', point: 'none' },
  compaction: 'none',
  modelMove: 'pinned',
  openings: 'core',
  pictures: false,
  web: 'none',
  law: null,
  touch: null,
  authorship: null,
  callEnvelopeMs: null,
  screen: false,
  continue: false,
  feed: 'turns',
  usage: 'none',
  aside: 'none',
};
