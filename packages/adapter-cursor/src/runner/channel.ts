import { Context, type Effect } from 'effect';
import type { AgentFault } from '@runlith/acp/agent';
import type { ClientRun } from '@runlith/hosted-runner/client';
import type { CursorSelection } from '../selection.js';
import type { HostedToolWire } from '@runlith/hosted-runner/wire/messages';
import type { OutputEvent } from '@runlith/hosted-runner/output';
import type { Relayed } from '@runlith/hosted-runner/relay';

export type Picture = { readonly data: string; readonly mimeType: string };
export type Message = { readonly text: string; readonly images: readonly Picture[] };
export type Sending = {
  readonly id: string;
  readonly message: Message;
  readonly model: CursorSelection | undefined;
  readonly tools: readonly HostedToolWire[];
  readonly force: boolean;
  readonly event: (event: OutputEvent) => Effect.Effect<void>;
  readonly call: (id: string, name: string, args: unknown) => Effect.Effect<Relayed>;
};
export interface Channel {
  readonly id: string;
  send(input: Sending): Effect.Effect<ClientRun, AgentFault>;
  readonly close: Effect.Effect<void>;
}
export type Opening = {
  readonly id: string | null;
  readonly cwd: string;
  readonly directory: string;
  readonly apiKey: string;
  readonly model: CursorSelection | undefined;
};
export class CursorSdk extends Context.Service<
  CursorSdk,
  {
    readonly open: (input: Opening) => Effect.Effect<Channel, AgentFault>;
  }
>()('adapter-cursor/CursorSdk') {}
