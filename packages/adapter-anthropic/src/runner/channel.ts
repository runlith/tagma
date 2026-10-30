import type { Effect } from 'effect';
import type { QuotaObservation } from '@runlith/llm/schema/quota';
import type { EffortLevel, ModelInfo, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentFault } from '@runlith/acp/agent';
import type { Reading } from './translate.js';

export type ThinkingDisplay = 'summarized' | 'omitted';

export type SideAnswer = { readonly response: string | null; readonly synthetic: boolean };

export type Interrupted = { readonly queued: readonly string[] | null; readonly dropped: readonly string[] };

export type Commanded = { readonly type: 'command_lifecycle'; readonly uuid: string; readonly state: string };

export type Said = SDKMessage | Commanded;

export type Entry = { readonly type: string; readonly uuid: string };

export interface Channel {
  readonly messages: AsyncIterable<Said>;
  models(): Effect.Effect<readonly ModelInfo[], AgentFault>;
  window(): Effect.Effect<number, AgentFault>;
  send(message: SDKUserMessage): Effect.Effect<void>;
  interrupt(): Effect.Effect<Interrupted, AgentFault>;
  withdraw(uuid: string): Effect.Effect<boolean, AgentFault>;
  setModel(model: string): Effect.Effect<void, AgentFault>;
  setEffort(effort: EffortLevel): Effect.Effect<void, AgentFault>;
  setThinking(display: ThinkingDisplay): Effect.Effect<void, AgentFault>;
  autoCompact(enabled: boolean): Effect.Effect<void, AgentFault>;
  sideQuestions(): Effect.Effect<(question: string) => Effect.Effect<SideAnswer | null, AgentFault>, AgentFault>;
  reading(): Effect.Effect<Reading | null, AgentFault>;
  quota(): Effect.Effect<QuotaObservation | null, AgentFault>;
  rejectedUntil(): number | null;
  close(): Effect.Effect<void>;
}

export interface ClaudeSdk {
  open(options: Options): Effect.Effect<Channel, AgentFault>;
  transcript(sessionId: string, dir: string): Promise<ReadonlyArray<Entry>>;
}
