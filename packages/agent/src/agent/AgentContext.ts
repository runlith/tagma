import type { Effect } from 'effect';
import type { CachePolicy } from '@runlith/llm/schema/options';
import type { Usage } from '@runlith/llm/schema/events';
import type { Message, ToolDefinition } from '@runlith/llm/schema/messages';
import type { AgentCallMeasurement } from './AgentCallMeasurement';
import type { AgentPhase } from './AgentPhase';
import type { AgentHostFailed } from './AgentFailure';

export type ProjectionBasis = 'measured' | 'none' | 'stale' | 'length' | 'prompt' | 'tools' | 'prefix';

export type AgentContext = {
  project(input: AgentContextInput): Effect.Effect<AgentContextProjection, AgentHostFailed>;
  lower(messages: readonly Message[]): Effect.Effect<readonly Message[], AgentHostFailed>;
  observe(request: AgentActualRequest, usage: Usage | undefined): Effect.Effect<AgentCallMeasurement | undefined, AgentHostFailed>;
};

export type AgentContextInput = {
  readonly stepNumber: number;
  readonly provider: string | null;
  readonly model: string | null;
  readonly system?: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly providerOptions?: unknown;
  readonly plannedOutputTokens: number;
  readonly contextOverflow: boolean;
  readonly phase?: (phase: AgentPhase['phase']) => Effect.Effect<void>;
};

export type AgentContextProjection = {
  readonly messages: readonly Message[];
  readonly estimate?: {
    readonly tokens: number;
    readonly contextWindow: number | null;
    readonly premiumAbove: number | null;
    readonly basis: ProjectionBasis;
  };
};

export type AgentActualRequest = {
  readonly runId: string;
  readonly stepNumber: number;
  readonly attempt: number;
  readonly activity?: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly account?: string;
  readonly reasoning?: string | null;
  readonly system: string | undefined;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly providerOptions: unknown;
  readonly plannedOutputTokens: number;
  readonly sentAt: string;
  readonly cache: CachePolicy | undefined;
};
