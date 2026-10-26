import { Data } from 'effect';
import type { AgentRuntimeGuidance } from '@runlith/agent/contracts';
import type { Usage } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { ThreadRunCost, ThreadRunKind } from '@runlith/agent/thread/rows';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';
import type { ThreadWordFate } from '@runlith/agent/thread/storage/inbox';
import type { ThreadEntry, TransportFailure } from '@runlith/agent/transcript/entries';
import type { FinishReason } from '@runlith/llm/schema/ids';
import type { WireFailureFamily } from '@runlith/llm/schema/errors';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';

export class HarnessBudgetSpent extends Data.TaggedError('HarnessBudgetSpent')<{ readonly allowed: number }> {
  override get message(): string {
    return `This agent tree has spent its budget of ${this.allowed} tokens; no further turn opens under it.`;
  }
}

export type HarnessTurnBegun = {
  readonly turn: string;
  readonly inputs: readonly string[];
  readonly words: string;
  readonly at: string;
  readonly noted?: AgentRuntimeGuidance | undefined;
};

export type HarnessTurnStarted = { readonly turn: string; readonly model: string | null; readonly kind: ThreadRunKind };

export type LaunchRefusal = 'passing' | 'lasting';

export type HarnessTurnEnded = {
  readonly turn: string;
  readonly at: string;
  readonly status: 'completed' | 'aborted' | 'failed';
  readonly rest?: Usage;
  readonly cost?: ThreadRunCost;
  readonly failure: string | null;
  readonly cause?: TransportFailure;
  readonly finish?: FinishReason;
  readonly stoppedBy: ThreadRunStoppedBy | null;
  readonly launch?: LaunchRefusal;
};

export type HarnessRequest = {
  readonly message: string;
  readonly attempt: number;
  readonly usage: Usage;
  readonly sentAt: string;
  readonly ttlSeconds: number | null;
};

export type HarnessRetry = {
  readonly order: number;
  readonly turn: string;
  readonly uuid: string;
  readonly attempt: number;
  readonly of: number;
  readonly delayMs: number;
  readonly family: WireFailureFamily;
  readonly status: number | null;
  readonly message: string;
};

export type HarnessTurnContext = {
  readonly order: number;
  readonly turn: string;
  readonly at: string;
  readonly measured: { readonly used: number; readonly size: number } | null;
  readonly request: HarnessRequest | null;
  readonly served: ThreadModelSelection | null;
};

export type HarnessTurnFate = {
  readonly fate: ThreadWordFate;
  readonly turn: string;
  readonly items: readonly string[];
  readonly recorded?: true;
  readonly noted?: AgentRuntimeGuidance | undefined;
};

export type HarnessTurnStep = {
  readonly name: HarnessName;
  readonly evidence: string;
  readonly started: readonly HarnessTurnStarted[];
  readonly begun: readonly HarnessTurnBegun[];
  readonly boundaries: readonly ThreadEntry[];
  readonly messages: readonly Message[] | undefined;
  readonly fates: readonly HarnessTurnFate[];
  readonly ended: readonly HarnessTurnEnded[];
  readonly contexts: readonly HarnessTurnContext[];
  readonly retries: readonly HarnessRetry[];
  readonly subject: string | null;
  readonly tail: boolean;
};
