import { Context, type Effect } from 'effect';
import type { AgentFault } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { PromptResult } from '@runlith/acp/methods';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import type { HostedToolWire } from '@runlith/hosted-runner/wire/messages';
import type { OutputEvent } from '@runlith/hosted-runner/output';
import type { Relayed } from '@runlith/hosted-runner/relay';

export type Selection = { readonly model: string; readonly effort: string | null };
export type Outcome = {
  readonly status: 'finished' | 'cancelled' | 'error';
  readonly failure?: TransportFailure;
  readonly detail?: string;
  readonly usage?: PromptResult['usage'];
};
export type Sending = {
  readonly system: string;
  readonly blocks: readonly ContentBlock[];
  readonly selection: Selection;
  readonly tools: readonly HostedToolWire[];
  readonly event: (event: OutputEvent) => Effect.Effect<void>;
  readonly call: (id: string, name: string, input: unknown) => Effect.Effect<Relayed>;
  readonly taken: Effect.Effect<void>;
};
export interface Run {
  readonly wait: Effect.Effect<Outcome, AgentFault>;
  readonly cancel: Effect.Effect<void, AgentFault>;
}
export interface Channel {
  readonly id: string;
  send(input: Sending): Effect.Effect<Run, AgentFault>;
  readonly close: Effect.Effect<void>;
}
export class OpenCodeSdk extends Context.Service<
  OpenCodeSdk,
  {
    readonly open: (
      input: { readonly id: string | null; readonly cwd: string },
      replacing: Effect.Effect<void, AgentFault>,
    ) => Effect.Effect<Channel, AgentFault>;
  }
>()('external-harnesses/OpenCodeSdk') {}
