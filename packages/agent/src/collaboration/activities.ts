import { activityKind } from '@runlith/activity/fact';

export type ReportAttrs = {
  readonly envelope: string;
  readonly request: string;
  readonly target: string;
};

export type ReportResult = {
  readonly status?: string;
  readonly targetRun?: string | null;
  readonly acted?: boolean;
};

export const REPORT = activityKind<ReportAttrs, ReportResult>('report');

export type AgentResultAttrs = {
  readonly child: string;
  readonly outcome: string;
};

export const AGENT_RESULT = activityKind<AgentResultAttrs>('agent-result');

export type CollaborationNote =
  | { readonly type: 'agent-spawned'; readonly agent: string; readonly child: string }
  | { readonly type: 'request-closed'; readonly request: string; readonly by: string }
  | { readonly type: 'closing-reminder'; readonly requests: readonly string[] }
  | {
      readonly type: 'run-reporting';
      readonly requests: number;
      readonly fallbacks: number;
      readonly diagnoses: number;
      readonly held: number;
      readonly closed: number;
    };
