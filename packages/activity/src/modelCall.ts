import { activityKind } from './fact';

export type ModelCallUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly reasoningTokens?: number;
};

export type ModelCallAttrs = {
  readonly provider: string;
  readonly model: string | null;
  readonly rung: string | null;
  readonly step?: number;
  readonly attempt?: number;
};

export type ModelCallResult = {
  readonly account?: string;
  readonly usage?: ModelCallUsage;
  readonly finish?: string | null;
  readonly firstEventMs?: number;
};

export const MODEL_CALL = activityKind<ModelCallAttrs, ModelCallResult>('model-call');
