import type { Effect } from 'effect';
import type { StructuredValue } from '@runlith/utils/object';
import type { ToolResultRetentionPolicy } from '@runlith/llm/profiles/contract';
import type { PermissionOutcome, PermissionSubject } from '../../permissions/vocabulary';
import type { ToolDisplay } from '../../tool/display';
import type { CallHooks } from '../AgentCalls';
import type { AgentToolFailure } from '../AgentFailure';
import type { CallAdmission, CallRecord } from '../callProgress';
import type { AgentToolOutputProjection } from '../ToolOutput';
import type {
  Tool,
  ToolCallArrival,
  ToolConfirmation,
  ToolContributor,
  ToolOutcome,
  ToolPreparation,
  ToolReader,
  ToolRefusal,
  ToolVerdict,
} from '../tool';
import { verdictOutcome } from '../tool';

export type AgentCallHooks<TCtx = unknown> = (ctx: TCtx) => CallHooks;

export type AgentToolOutcome = AgentToolOutputProjection & {
  readonly executed: boolean;
  readonly verdict: ToolVerdict;
  readonly durationMs?: number;
  readonly display: ToolDisplay;
  readonly completion?: 'command';
  readonly guidance?: readonly string[];
};

export function doorToolOutcome(settled: AgentToolOutcome): ToolOutcome {
  return verdictOutcome(settled.verdict, settled.output);
}

type AgentToolRequest = {
  readonly name: string;
  readonly input: unknown;
  readonly tool: Tool;
};

export type AgentPermissionQuestion = AgentToolRequest & {
  readonly toolCallId: string;
  readonly resultRetention?: ToolResultRetentionPolicy;
};

export type AgentToolInvocation = AgentToolRequest & {
  readonly arguments?: string;
  readonly confirmed?: true;
  readonly confirming?: true;
  readonly resultRetention?: ToolResultRetentionPolicy;
  readonly onDisplay?: (display: ToolDisplay) => Effect.Effect<void>;
  readonly onExecution?: (admission: CallAdmission) => Effect.Effect<void, AgentToolFailure>;
  readonly options: { readonly toolCallId: string } & ToolCallArrival;
};

export type AgentToolOpening = {
  readonly input: unknown;
  readonly rawInput: unknown;
  readonly display: ToolDisplay | undefined;
  readonly openedAt: number;
  readonly resultRetention?: ToolResultRetentionPolicy;
};

export type AgentToolPreflight = AgentPermissionQuestion &
  AgentToolOpening & {
    readonly subjects: readonly PermissionSubject[];
    readonly prepared: unknown;
    readonly permission: PermissionOutcome;
    readonly confirmation: ToolConfirmation | undefined;
    readonly reader?: ToolReader;
    readonly contributor?: ToolContributor;
    readonly rewritten?: true;
  };

export type AgentToolStop = {
  readonly toolCallId: string;
  readonly reason: string;
  readonly refusal?: ToolRefusal;
};

export type AgentToolAttended =
  | { readonly kind: 'prepared'; readonly prepared: AgentToolPreflight }
  | { readonly kind: 'answered'; readonly outcome: AgentToolOutcome };

export type AgentCallAdoption =
  | { readonly refused: string }
  | {
      readonly call: CallRecord;
      readonly receipt: AgentToolOutcome;
      readonly live: Effect.Effect<void>;
      readonly abandon: Effect.Effect<void>;
      readonly settled: Effect.Effect<void>;
    };

export type AgentCallQuestion = {
  readonly prepared: AgentToolPreflight;
  readonly stopped: Effect.Effect<AgentToolStop>;
  readonly moved: Effect.Effect<void>;
  readonly background: () => boolean;
};

export type AgentCallVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly stopped?: true;
      readonly refusal?: ToolRefusal;
      readonly output: { readonly status: string; readonly reason: string; readonly by?: string; readonly note?: string };
    };

export type AgentToolResolution = {
  readonly toolCallId: string;
  readonly name: string;
  readonly input: unknown;
  readonly judged: unknown;
  readonly rewritten?: true;
  readonly generation: number;
  readonly preparation: ToolPreparation<unknown>;
  readonly reader?: ToolReader;
  readonly contributor?: ToolContributor;
};

export type AgentToolProduced = {
  readonly name: string;
  readonly tool: Tool;
  readonly input: unknown;
  readonly arguments?: string;
  readonly output: StructuredValue | undefined;
  readonly toolCallId: string;
};
