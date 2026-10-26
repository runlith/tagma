import { Usage } from '@runlith/llm/schema/events';
import type { ThreadContextReading } from '../../rows';
import type { ContextReport } from './RunReports';

const carried = (next: ThreadContextReading, prior: ThreadContextReading | null): ThreadContextReading =>
  prior !== null &&
  !prior.stale &&
  prior.runId === next.runId &&
  prior.sentAt !== undefined &&
  next.sentAt === undefined &&
  next.cache === undefined
    ? { ...next, sentAt: prior.sentAt, cache: prior.cache }
    : next;

const compactedTo = (
  prior: ThreadContextReading,
  report: { readonly tokens: number; readonly measuredAt: string },
): ThreadContextReading => ({
  usage: Usage.from({ inputTokens: report.tokens, totalTokens: report.tokens }),
  contextWindow: prior.contextWindow,
  inputLimit: prior.inputLimit,
  runId: prior.runId,
  stepNumber: prior.stepNumber,
  provider: prior.provider,
  model: prior.model,
  account: prior.account,
  reasoning: prior.reasoning,
  measuredAt: report.measuredAt,
  stale: false,
});

export const readingAfter = (report: ContextReport, prior: ThreadContextReading | null): ThreadContextReading | null =>
  report.kind === 'measured'
    ? carried(report.reading, prior)
    : prior === null
      ? null
      : report.kind === 'compacted'
        ? compactedTo(prior, report)
        : { ...prior, stale: true };
