import { Schema } from 'effect';
import { HotFunction, InsightDetail, InsightSet, TraceSummary } from '../contract/wire/trace.js';

export const SETS_KEPT = 20;

export const SetDetail = Schema.Struct({
  id: InsightSet.fields.id,
  insights: Schema.Array(InsightDetail),
  hot: Schema.Array(HotFunction),
});
export type SetDetail = typeof SetDetail.Type;

export const Summary = Schema.Struct({ version: Schema.Literal(2), ...TraceSummary.fields });

const { durationMs: _durationMs, sets: _sets, setsTotal: _setsTotal, ...recorded } = TraceSummary.fields;

export const Recorded = Schema.Struct(recorded);
export type Recorded = typeof Recorded.Type;

export const AnalysisAsk = Schema.Struct({
  id: Schema.Int,
  file: Schema.String,
  summary: Schema.String.annotate({ description: 'The summary file, written last: its presence means the analysis is whole.' }),
  set: Schema.String.annotate({ description: 'The per-set file path with `{n}` standing for the set index.' }),
  recorded: Recorded,
  metadata: Schema.Struct({
    cpuThrottling: Schema.Finite,
    networkThrottling: Schema.NullOr(Schema.String),
    network: Schema.NullOr(Schema.Struct({ latency: Schema.Finite, download: Schema.Finite, upload: Schema.Finite })),
  }),
});
export type AnalysisAsk = typeof AnalysisAsk.Type;

export const AnalysisAnswer = Schema.Union([
  Schema.Struct({ id: Schema.Int, ready: Schema.Literal(true) }),
  Schema.Struct({ id: Schema.Int, summary: TraceSummary }),
  Schema.Struct({ id: Schema.Int, failed: Schema.String }),
]);
export type AnalysisAnswer = typeof AnalysisAnswer.Type;
