import type { Effect } from 'effect';
import type { AgentFault, Outlet } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { InitializeResult, McpServer, PromptResult } from '@runlith/acp/methods';
import type { SessionConfigOption, SessionModeState } from '@runlith/acp/updates';
import type { HostedMessage } from '../../contract/wire/hosted.js';
import type { HostedListed, HostedOpened } from './door.js';
import type { Extension, Notification } from '../../contract/wire/extensions.js';

export type Steered = { readonly outcome: 'injected' | 'startedNewTurn' | 'promptRequired' };
export type Withdrawn = { readonly withdrawn: boolean };

export type Opening = {
  readonly id: string;
  readonly cwd: string;
  readonly mcpServers: readonly McpServer[];
  readonly additionalDirectories: readonly string[];
  readonly origin: 'new' | 'resume';
  readonly held?: string;
  readonly history: readonly HostedMessage[];
};

export type Prepared = { readonly opened: HostedOpened; readonly listed: HostedListed };
export type Input = { readonly id: string; readonly prompt: readonly ContentBlock[]; readonly context: string | null };

export interface Session {
  readonly id: string;
  readonly cwd: string;
  configOptions(): readonly SessionConfigOption[];
  busy(): boolean;
  readonly turning?: (active: boolean) => void;
  prepare(input: Prepared): Effect.Effect<void, AgentFault>;
  start(input: Input): Effect.Effect<Effect.Effect<PromptResult, AgentFault>, AgentFault>;
  steer(prompt: readonly ContentBlock[], input: string | undefined): Effect.Effect<Steered, AgentFault>;
  cancel(): Effect.Effect<void>;
  configure(configId: string, value: string): Effect.Effect<readonly SessionConfigOption[], AgentFault>;
  close(): Effect.Effect<void>;
  readonly withdraw?: (input: string) => Effect.Effect<Withdrawn, AgentFault>;
  readonly compact?: (instructions: string, at: 'step' | 'end') => Effect.Effect<unknown, AgentFault>;
  readonly aside?: (question: string) => Effect.Effect<unknown, AgentFault>;
}

export interface Cycle {
  readonly initialize: InitializeResult;
  readonly extensions: readonly (Extension | Notification)[];
  readonly modes: SessionModeState;
  open(opening: Opening, outlet: Outlet, replacing: Effect.Effect<void, AgentFault>): Effect.Effect<Session, AgentFault>;
  readonly fork?: (
    from: string,
    cwd: string,
    turn: string | null,
    outlet: Outlet,
    replacing: Effect.Effect<void, AgentFault>,
  ) => Effect.Effect<Session, AgentFault>;
}

export type Process = {
  readonly stderr: (text: string) => void;
  readonly died: (reason: string) => Effect.Effect<void>;
};
