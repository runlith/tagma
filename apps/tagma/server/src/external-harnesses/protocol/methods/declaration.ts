import { type Exit, Schema } from 'effect';
import type { ClientEvent, Failure } from '@runlith/acp/events';
import type { ClientRequest } from '@runlith/acp/state';
import type { AgentAsideAnswer } from '@runlith/agent/AgentAside';
import type { AgentRuntimeGuidance } from '@runlith/agent/contracts';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { ThreadEntry } from '@runlith/agent/transcript/entries';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Sealed } from '../projection.js';
import type { ProtocolRow } from '../row.js';
import type { HarnessRetry } from '../turns.js';

export type ExtensionRequest = Extract<ClientRequest, { readonly meaning: 'extension' }>;

export type Settlement = Extract<ClientEvent, { readonly _tag: 'ExtensionAnswered' | 'RequestFailed' }>;

export type Notice = Extract<ClientEvent, { readonly _tag: 'Extended' }>;

export type Settled<A> =
  | { readonly _tag: 'Answered'; readonly answer: A; readonly event: Settlement }
  | { readonly _tag: 'Failed'; readonly cause: Failure; readonly event: Settlement };

export type WordsFate = {
  readonly _tag: 'Confirmed' | 'Returned' | 'Unconfirmed' | 'Withdrawn';
  readonly turn: string;
  readonly envelopes: readonly string[];
  readonly noted?: AgentRuntimeGuidance | undefined;
};

export type Fate = WordsFate | { readonly _tag: 'Acknowledged'; readonly turn: string; readonly ids: readonly string[] };

export type AsideOutcome = Exit.Exit<AgentAsideAnswer, LLMError>;

export type WithdrawOutcome = Exit.Exit<boolean, GateRefusal>;

export type Answered<A> = { readonly request: string; readonly outcome: A };

export type Handled = {
  readonly row: ProtocolRow;
  readonly events: readonly ClientEvent[];
  readonly sealed: Sealed | null;
  readonly boundaries: readonly ThreadEntry[];
  readonly fates: readonly Fate[];
  readonly trim: string | null;
  readonly asides: readonly Answered<AsideOutcome>[];
  readonly withdrawals: readonly Answered<WithdrawOutcome>[];
  readonly retries: readonly HarnessRetry[];
};

export interface Answering {
  readonly refusal: GateRefusal | null;
  answered(row: ProtocolRow, request: ExtensionRequest, event: Settlement, at: string): Handled;
  doubted?(row: ProtocolRow, request: ExtensionRequest): Handled;
}

export interface Noticing {
  noticed(row: ProtocolRow, event: Notice, at: string): Handled;
}

export const handled = (row: ProtocolRow, events: readonly ClientEvent[] = []): Handled => ({
  row,
  events,
  sealed: null,
  boundaries: [],
  fates: [],
  trim: null,
  asides: [],
  withdrawals: [],
  retries: [],
});

export const settledBy = <A>(answer: Schema.Codec<A, unknown>) => {
  const decode = Schema.decodeUnknownResult(answer);
  return (event: Settlement): Settled<A> => {
    if (event._tag === 'RequestFailed') return { _tag: 'Failed', cause: event.cause, event };
    const read = decode(event.result);
    return read._tag === 'Success'
      ? { _tag: 'Answered', answer: read.success, event }
      : { _tag: 'Failed', cause: { _tag: 'Unreadable', body: event.result }, event };
  };
};
