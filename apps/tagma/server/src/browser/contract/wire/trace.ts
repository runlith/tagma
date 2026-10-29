import type * as Trace from '@paulirish/trace_engine';
import { family } from '@runlith/paging';
import { Schema } from 'effect';

export const INSIGHTS = [
  'LCPBreakdown',
  'INPBreakdown',
  'CLSCulprits',
  'DocumentLatency',
  'RenderBlocking',
  'LCPDiscovery',
  'NetworkDependencyTree',
  'ImageDelivery',
  'FontDisplay',
  'Viewport',
  'DOMSize',
  'ThirdParties',
  'DuplicatedJavaScript',
  'SlowCSSSelector',
  'ForcedReflow',
  'Cache',
  'CharacterSet',
  'ModernHTTP',
  'LegacyJavaScript',
] as const satisfies readonly (keyof Trace.Insights.Types.InsightModelsType)[];
export type InsightName = (typeof INSIGHTS)[number];

export const INSIGHT_STATES = ['pass', 'fail', 'informative'] as const;

export const TRACE_ACTIONS = ['load', 'start', 'stop'] as const;

export const QUIET_MS = 500;

export const LOAD_TIMEOUT_MS = 30_000;

export const TraceId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]+@\d+$/u)).annotate({
  description: 'The trace id trace_page answered.',
});
export type TraceId = typeof TraceId.Type;

const Ms = Schema.Finite;

export const LcpPhases = Schema.Struct({
  ttfb: Ms,
  loadDelay: Schema.NullOr(Ms),
  loadDuration: Schema.NullOr(Ms),
  renderDelay: Ms,
});

export const Lcp = Schema.Struct({
  ms: Ms,
  element: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  phases: Schema.NullOr(LcpPhases),
});
export type Lcp = typeof Lcp.Type;

export const FailedInsight = Schema.Struct({ insight: Schema.Literals(INSIGHTS), line: Schema.String });

export const InsightSet = Schema.Struct({
  id: Schema.String.annotate({ description: 'NAVIGATION_<n> for a navigation, NO_NAVIGATION for the range before any.' }),
  url: Schema.String,
  startMs: Ms.annotate({ description: 'Where the set starts, in milliseconds from the start of the trace.' }),
  durationMs: Ms,
  lcp: Schema.NullOr(Lcp),
  inpMs: Schema.NullOr(Ms),
  cls: Schema.NullOr(Schema.Finite),
  failed: Schema.Array(FailedInsight),
});
export type InsightSet = typeof InsightSet.Type;

export const TraceSummary = Schema.Struct({
  trace: TraceId,
  path: Schema.String,
  bytes: Schema.Int,
  durationMs: Ms,
  conditions: Schema.NullOr(Schema.String),
  dataLoss: Schema.Boolean.annotate({ description: 'Chromium reported dropping events: the trace buffer filled.' }),
  settled: Schema.NullOr(Schema.Boolean).annotate({
    description: 'For a load: whether the page reached its load event and a quiet with no request in flight before the deadline.',
  }),
  sets: Schema.Array(InsightSet),
  setsTotal: Schema.Int.annotate({ description: 'How many insight sets the trace holds; the first twenty are kept and listed.' }),
});
export type TraceSummary = typeof TraceSummary.Type;

export const InsightDetail = Schema.Struct({
  insight: Schema.Literals(INSIGHTS),
  state: Schema.Literals(INSIGHT_STATES),
  line: Schema.String,
  lines: Schema.Array(Schema.String),
});
export type InsightDetail = typeof InsightDetail.Type;

export const HotFunction = Schema.Struct({
  function: Schema.String,
  url: Schema.String,
  line: Schema.Int.annotate({ description: '1-based; 0 when the engine knows no line.' }),
  selfMs: Ms,
  totalMs: Ms,
});
export type HotFunction = typeof HotFunction.Type;

export const HOT_ROWS = family('trace-hot', 1, 'json', { text: 180, json: 180 }, 20, () => ({
  function: 'x'.repeat(40),
  url: `http://127.0.0.1:5173/${'x'.repeat(80)}.js`,
  line: 4_120,
  selfMs: 1_234.5,
  totalMs: 12_345.6,
}));
