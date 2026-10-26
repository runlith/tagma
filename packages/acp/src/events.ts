import type { Envelope, Fault } from '@runlith/ndjson-rpc/envelope';
import type { Inbound } from '@runlith/ndjson-rpc/exchange';
import type { ContentBlock } from './content';
import type {
  ClientCapabilities,
  Implementation,
  InitializeResult,
  LoadSessionParams,
  NewSessionParams,
  PermissionOutcome,
  PromptParams,
  ResumeSessionParams,
  SessionParams,
  SessionSetup,
  SetSessionConfigOptionParams,
  SetSessionModeParams,
  StopReason,
  Usage,
} from './methods';
import type { AgentRequest, ClientRequest, ClientState, OpenMessage, Reply } from './state';
import type { ToolCall, ToolCallUpdate } from './toolCalls';
import type { SessionConfigOption, SessionUpdate } from './updates';

export type Receipt = { readonly _tag: 'Request'; readonly id: string } | { readonly _tag: 'Answer'; readonly id: string | number };

export type Observation =
  | { readonly _tag: 'Frame'; readonly inbound: Inbound }
  | { readonly _tag: 'Gap'; readonly resume: bigint }
  | { readonly _tag: 'Admitted'; readonly receipt: Receipt }
  | { readonly _tag: 'Unwritten'; readonly receipt: Receipt }
  | { readonly _tag: 'Unknown'; readonly receipt: Receipt }
  | { readonly _tag: 'Oversized'; readonly start: bigint; readonly ceiling: number; readonly session: SessionParams | null }
  | { readonly _tag: 'Recovered' }
  | { readonly _tag: 'Exited'; readonly detail: string };

export type Intent =
  | { readonly _tag: 'Initialize'; readonly capabilities: ClientCapabilities; readonly info: Implementation }
  | { readonly _tag: 'Extensions'; readonly methods: ReadonlyArray<string> }
  | { readonly _tag: 'NewSession'; readonly params: NewSessionParams }
  | { readonly _tag: 'LoadSession'; readonly params: LoadSessionParams }
  | { readonly _tag: 'ResumeSession'; readonly params: ResumeSessionParams }
  | { readonly _tag: 'Prompt'; readonly turn: string; readonly envelopes: ReadonlyArray<string>; readonly params: PromptParams }
  | { readonly _tag: 'Configure'; readonly params: SetSessionConfigOptionParams }
  | { readonly _tag: 'SetMode'; readonly params: SetSessionModeParams }
  | { readonly _tag: 'Close'; readonly params: SessionParams }
  | { readonly _tag: 'Extend'; readonly method: string; readonly params: unknown; readonly envelopes: ReadonlyArray<string> }
  | { readonly _tag: 'Cancel'; readonly params: SessionParams }
  | { readonly _tag: 'Stop'; readonly params: SessionParams; readonly until: number };

export type Answer = { readonly _tag: 'Permission'; readonly outcome: PermissionOutcome } | Reply;

export type Outbound = { readonly receipt: Receipt | null; readonly envelope: Envelope };

export type Failure =
  | { readonly _tag: 'Agent'; readonly error: Fault }
  | { readonly _tag: 'Unreadable'; readonly body: unknown }
  | { readonly _tag: 'Protocol'; readonly answered: number }
  | { readonly _tag: 'Unwritten' }
  | { readonly _tag: 'Oversized'; readonly ceiling: number }
  | { readonly _tag: 'Exited'; readonly detail: string };

export type TurnOutcome =
  | {
      readonly _tag: 'Stopped';
      readonly stopReason: StopReason;
      readonly usage: Usage | null;
      readonly meta: Readonly<Record<string, unknown>> | null;
    }
  | {
      readonly _tag: 'Failed';
      readonly cause: Failure;
      readonly usage?: Usage | null;
      readonly meta?: Readonly<Record<string, unknown>> | null;
    };

export type Delivery = 'accepted' | 'refused' | 'unconfirmed';

export type ClientEvent =
  | { readonly _tag: 'Initialized'; readonly result: InitializeResult }
  | { readonly _tag: 'SessionReady'; readonly via: 'new' | 'load' | 'resume'; readonly sessionId: string; readonly setup: SessionSetup }
  | { readonly _tag: 'ConfigChanged'; readonly configOptions: ReadonlyArray<SessionConfigOption> }
  | { readonly _tag: 'ModeChanged'; readonly modeId: string }
  | { readonly _tag: 'SessionClosed'; readonly sessionId: string }
  | { readonly _tag: 'ExtensionAnswered'; readonly request: ClientRequest; readonly result: unknown }
  | { readonly _tag: 'Extended'; readonly id: string; readonly method: string; readonly params: unknown }
  | { readonly _tag: 'Signaled'; readonly turn: string | null; readonly method: string; readonly params: unknown }
  | { readonly _tag: 'RequestFailed'; readonly request: ClientRequest; readonly cause: Failure }
  | {
      readonly _tag: 'Delta';
      readonly turn: string;
      readonly stream: OpenMessage['stream'];
      readonly messageId: string | null;
      readonly content: ContentBlock;
    }
  | { readonly _tag: 'Message'; readonly turn: string; readonly message: OpenMessage; readonly closing?: true }
  | { readonly _tag: 'ToolCallStarted'; readonly turn: string; readonly call: ToolCall }
  | { readonly _tag: 'ToolCallChanged'; readonly turn: string; readonly call: ToolCall; readonly update: ToolCallUpdate }
  | { readonly _tag: 'ToolCallEnded'; readonly turn: string; readonly call: ToolCall; readonly update: ToolCallUpdate | null }
  | { readonly _tag: 'ToolCallAmended'; readonly turn: string; readonly update: ToolCallUpdate }
  | { readonly _tag: 'Asked'; readonly ask: AgentRequest }
  | { readonly _tag: 'Answered'; readonly ask: AgentRequest }
  | { readonly _tag: 'Withdrawn'; readonly asks: ReadonlyArray<AgentRequest> }
  | {
      readonly _tag: 'TurnEnded';
      readonly turn: string;
      readonly envelopes: ReadonlyArray<string>;
      readonly delivery: Delivery;
      readonly outcome: TurnOutcome;
    }
  | { readonly _tag: 'Uncertain'; readonly requests: ReadonlyArray<ClientRequest>; readonly asks: ReadonlyArray<AgentRequest> }
  | { readonly _tag: 'Gapped'; readonly from: bigint; readonly to: bigint }
  | { readonly _tag: 'SessionChanged'; readonly update: SessionUpdate }
  | { readonly _tag: 'Unrecognized'; readonly method: string; readonly raw: unknown }
  | { readonly _tag: 'Malformed'; readonly problem: string; readonly excerpt: string }
  | { readonly _tag: 'Stray'; readonly envelope: Envelope };

export type Step = {
  readonly state: ClientState;
  readonly frames: ReadonlyArray<Outbound>;
  readonly events: ReadonlyArray<ClientEvent>;
  readonly durable: boolean;
};

export type Acted = Step & { readonly request: string | null };
