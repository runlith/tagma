import { Result, Schema } from 'effect';
import type { ClientEvent } from '@runlith/acp/events';
import { Usage } from '@runlith/llm/schema/events';
import { MEASURED, Measured } from '../contract/wire/extensions.js';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { HarnessRequest, HarnessTurnContext } from './turns.js';

const decodeMeasured = Schema.decodeUnknownResult(Measured);

export type Measurement = {
  readonly order: number;
  readonly context: { readonly used: number; readonly size: number } | null;
  readonly request: HarnessRequest | null;
  readonly unreadable: boolean;
};

const carried = (meta: unknown): unknown =>
  typeof meta === 'object' && meta !== null && MEASURED in meta ? (meta as Readonly<Record<string, unknown>>)[MEASURED] : undefined;

const requestOf = (measured: Measured): HarnessRequest => ({
  message: measured.message,
  attempt: measured.attempt ?? 0,
  sentAt: measured.sentAt,
  ttlSeconds: measured.ttlSeconds,
  usage: Usage.from({
    inputTokens: measured.input,
    nonCachedInputTokens: measured.input - measured.cacheRead - measured.cacheWrite,
    cacheReadInputTokens: measured.cacheRead,
    cacheWriteInputTokens: measured.cacheWrite,
    outputTokens: measured.output,
    reasoningTokens: measured.reasoning ?? undefined,
    totalTokens: measured.input + measured.output,
  }),
});

export type MeasuredStep = {
  readonly compacted: string | null;
  readonly measuredIn: string | null;
  readonly at: string;
  readonly served: ThreadModelSelection | null;
  readonly base: Measurement['context'];
};

export const contextsOf = (measurements: readonly Measurement[], step: MeasuredStep): readonly HarnessTurnContext[] => {
  const { compacted, measuredIn, at, served } = step;
  if (compacted !== null) return [{ order: 0, turn: compacted, at, measured: step.base, request: null, served }];
  if (measuredIn === null) return [];
  return measurements.flatMap((measuring) =>
    measuring.context === null && measuring.request === null
      ? []
      : [{ order: measuring.order, turn: measuredIn, at, measured: measuring.context, request: measuring.request, served }],
  );
};

export const measures = (event: ClientEvent): boolean => event._tag === 'SessionChanged' && event.update.sessionUpdate === 'usage_update';

export const measurementOf = (event: ClientEvent): Measurement | null => {
  if (event._tag !== 'SessionChanged' || event.update.sessionUpdate !== 'usage_update') return null;
  const update = event.update;
  const meta = carried(update._meta);
  const read = meta === undefined ? null : decodeMeasured(meta);
  return {
    order: 0,
    context: update.size > 0 ? { used: update.used, size: update.size } : null,
    request: read !== null && Result.isSuccess(read) ? requestOf(read.success) : null,
    unreadable: read !== null && Result.isFailure(read),
  };
};
