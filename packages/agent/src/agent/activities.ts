import { activityKind } from '@runlith/activity/fact';
import type { ModelCallUsage } from '@runlith/activity/modelCall';
import type { ProjectionBasis } from './AgentContext';
import type { CallAfter } from './callProgress';
import type { AgentHook } from './contracts';

export type RunAttrs = {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly work?: string;
  readonly modelSteps?: 'unobserved';
};

export type RunResult = {
  readonly finish?: string;
  readonly usage?: ModelCallUsage;
};

export const RUN = activityKind<RunAttrs, RunResult>('run');

export type ToolCallAttrs = {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly executedBy: 'host' | 'provider';
};

export const TOOL_CALL = activityKind<ToolCallAttrs>('tool-call');

export type ToolPreflightAttrs = {
  readonly toolName: string;
  readonly toolCallId: string;
};

export type ToolPreflightResult = {
  readonly verdict?: 'allow' | 'ask' | 'deny';
  readonly rule?: string;
};

export const TOOL_PREFLIGHT = activityKind<ToolPreflightAttrs, ToolPreflightResult>('tool-preflight');

export type ProjectionAttrs = {
  readonly step: number;
  readonly attempt: number;
  readonly contextOverflow: boolean;
  readonly given: number;
};

export type ProjectionResult = {
  readonly produced?: number;
  readonly basis?: ProjectionBasis;
};

export const PROJECTION = activityKind<ProjectionAttrs, ProjectionResult>('projection');

export type AgentNote =
  | {
      readonly type: 'step-retry';
      readonly step: number;
      readonly attempt: number;
      readonly retry: number;
      readonly of: number;
      readonly family: string;
      readonly delayMs: number;
    }
  | { readonly type: 'step-continued'; readonly step: number; readonly continued: number; readonly of: number }
  | { readonly type: 'tool-executing' }
  | { readonly type: 'tool-ordered'; readonly after: readonly CallAfter[]; readonly waitedMs: number }
  | {
      readonly type: 'rule-failed';
      readonly ruleId: string;
      readonly owner: string;
      readonly hook: AgentHook;
      readonly message: string;
    }
  | {
      readonly type: 'rule-slow';
      readonly ruleId: string;
      readonly owner: string;
      readonly hook: AgentHook;
      readonly invokeMs: number;
      readonly settleMs: number;
    };
