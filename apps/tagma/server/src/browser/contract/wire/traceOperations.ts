import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { Glance } from './page.js';
import { WAIT_CEILING_MS } from './pageOperations.js';
import { ACTING, DRIVE_REFUSALS, page, project, READING } from './shape.js';
import {
  HOT_ROWS,
  HotFunction,
  INSIGHTS,
  InsightDetail,
  LOAD_TIMEOUT_MS,
  QUIET_MS,
  TRACE_ACTIONS,
  TraceId,
  TraceSummary,
} from './trace.js';

export const TRACE_OPERATIONS = {
  trace_page: operation('trace_page', {
    ...ACTING,
    meaning:
      "Record a performance trace of a page — a reload or what you do on it — and answer its Core Web Vitals and DevTools' failed insights per navigation.",
    grammar: `\`load\` reloads the page under a trace (\`cold\` bypasses the HTTP cache) and stops once the load event is followed by ${QUIET_MS} ms with no request in flight; past \`timeoutMs\` (${LOAD_TIMEOUT_MS} ms by default) it stops anyway and \`settled\` says false. \`start\` begins a trace you end with \`stop\` after acting on the page with the usual tools. A page holds one trace at a time: a second start refuses \`trace-running\`. A trace started by a thread stops when its run ends. The file is gzip JSON that Chrome DevTools opens; \`screenshots\` adds filmstrip frames and grows it. \`conditions\` names the CPU and network slowdown it ran under. read_page_trace reads one insight's details or the hottest functions.`,
    input: Schema.Struct({
      project,
      page,
      action: Schema.Literals(TRACE_ACTIONS),
      cold: Schema.optional(Schema.Boolean),
      screenshots: Schema.optional(Schema.Boolean),
      timeoutMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: WAIT_CEILING_MS }))).annotate({
        description: `For load: how long to wait for the page to settle, at most ${WAIT_CEILING_MS} ms.`,
      }),
    }),
    answer: arms({
      started: { page: Glance, trace: TraceId, path: Schema.String.annotate({ description: 'Where the trace is written once it stops.' }) },
      traced: { page: Glance, ...TraceSummary.fields },
    }),
    refusals: [...DRIVE_REFUSALS, 'trace-running', 'no-trace', 'trace-failed'],
    confirmation: (input) => ({ summary: input.action === 'stop' ? 'Stop the trace?' : 'Trace the page?' }),
    confirmLabel: 'Trace page',
    presentation: { running: 'Tracing the page', done: 'Traced the page' },
  }),
  read_page_trace: operation('read_page_trace', {
    ...READING,
    meaning: 'Read a recorded page trace: its summary, one insight in detail, or the hottest main-thread functions.',
    grammar:
      'Without `insight` or `hot` it answers the summary trace_page answered. `insight` names a DevTools insight (LCPBreakdown, RenderBlocking, INPBreakdown…) and answers its details; `hot` ranks the main thread’s functions by self time. Both read one insight set, `set` naming it — the first navigation by default.',
    input: Schema.Struct({
      project,
      trace: TraceId,
      set: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      insight: Schema.optional(Schema.Literals(INSIGHTS)),
      hot: Schema.optional(Schema.Boolean),
      limit: limitOf(HOT_ROWS),
    }),
    answer: arms({
      summary: TraceSummary.fields,
      insight: { trace: TraceId, set: Schema.String, ...InsightDetail.fields },
      hot: { trace: TraceId, set: Schema.String, functions: Schema.Array(HotFunction), shown: Schema.Int, total: Schema.Int },
    }),
    refusals: ['no-trace', 'action-shape'],
    page: HOT_ROWS,
    confirmation: () => ({ summary: 'Read the trace?' }),
    confirmLabel: 'Read trace',
    presentation: { running: 'Reading the trace', done: 'Read the trace' },
  }),
};

export type TraceOperationId = keyof typeof TRACE_OPERATIONS;
