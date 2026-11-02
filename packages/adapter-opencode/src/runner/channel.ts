import { Context, type Effect } from 'effect';
import type { AgentFault } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { Usage } from '@runlith/acp/methods';
import type { Measured } from '@runlith/hosted-runner/wire/extensions';
import type { ClientRun } from '@runlith/hosted-runner/client';
import type { ForkPoint } from '@runlith/hosted-runner/cycle';
import type { HostedToolWire } from '@runlith/hosted-runner/wire/messages';
import type { OutputEvent } from '@runlith/hosted-runner/output';
import type { Relayed } from '@runlith/hosted-runner/relay';

export type Selection = { readonly model: string; readonly effort: string | null };
export type Sending = {
  readonly system: string;
  readonly blocks: readonly ContentBlock[];
  readonly selection: Selection;
  readonly tools: readonly HostedToolWire[];
  readonly event: (event: OutputEvent) => Effect.Effect<void>;
  readonly call: (id: string, name: string, input: unknown) => Effect.Effect<Relayed>;
  readonly taken: Effect.Effect<void>;
};
type Compacting = {
  readonly system: string;
  readonly instructions: string;
  readonly at: 'step' | 'end';
  readonly selection: Selection;
  readonly measure: (reading: Measured) => Effect.Effect<void>;
};
export type Compacted = { readonly summary: string; readonly usage?: Usage };
export interface Channel {
  readonly id: string;
  send(input: Sending): Effect.Effect<ClientRun, AgentFault>;
  compact(input: Compacting): Effect.Effect<Compacted, AgentFault>;
  readonly cancelCompaction: Effect.Effect<void, AgentFault>;
  readonly close: Effect.Effect<void>;
}
export class OpenCodeSdk extends Context.Service<
  OpenCodeSdk,
  {
    readonly open: (
      input: { readonly id: string | null; readonly cwd: string; readonly fork?: ForkPoint },
      replacing: Effect.Effect<void, AgentFault>,
    ) => Effect.Effect<Channel, AgentFault>;
  }
>()('external-harnesses/OpenCodeSdk') {}
