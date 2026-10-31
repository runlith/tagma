import { cpuProfileRequestSchema } from '@runlith/performance/CpuProfile';
import { heapSnapshotRequestSchema } from '@runlith/performance/HeapSnapshot';
import { memoryCaptureRequestSchema } from '@runlith/performance/protocol/records';
import { performanceQuerySchema } from '@runlith/performance/protocol/queries';
import { Schema, Tuple } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { HandedArtifact, performanceCaptureValueSchema, performanceReadValueSchema } from './performance.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { WatchReading } from '../../../platform/contract/wire/watch.js';

export const WATCH_ROWS = { default: 20, ceiling: 200 } as const;

const hostPerformanceQuerySchema = performanceQuerySchema.mapMembers(
  Tuple.map(Schema.fieldsAssign({ state: Schema.optional(Schema.String) })),
);

const CAPTURED = arms({ ok: { performance: performanceCaptureValueSchema } });
const READ = arms({ ok: { performance: performanceReadValueSchema, artifact: Schema.optional(HandedArtifact) } });

export const PERFORMANCE_OPERATIONS = {
  capture_performance_profile: operation('capture_performance_profile', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: CAPTURED,
    meaning: 'Capture one on-demand CPU profile of this Tagma process and persist it for later reads.',
    grammar:
      'The profiler holds the asked window; a stall inside it keeps its freeze as a profile of its own, and `cuts` names each one, so the kept record then covers less than it asked. Returns that record, a typed profiler failure or store unavailability; read_performance `profile` ranks its frames.',
    input: cpuProfileRequestSchema,
    refusals: [],
    confirmation: (input: { readonly requestedBy: string; readonly requestedDurationMs: number }) => ({
      summary: `Capture ${input.requestedDurationMs} ms of CPU activity for ${input.requestedBy}?`,
      consequence: 'The process profiler runs for the requested interval and stores one bounded telemetry record.',
    }),
    confirmLabel: 'Capture',
    presentation: {
      running: 'Capturing a CPU profile',
      done: 'Captured a CPU profile',
    },
    subjects: () => [],
  }),
  capture_memory_reading: operation('capture_memory_reading', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: CAPTURED,
    meaning: 'Persist a heap census by object type for the main and store-worker isolates, for later comparison.',
    grammar:
      '`collect` runs full GC first and records it. A whole-heap walk pauses the process (about 20 ns/object); the result reports its duration. `reading-kept` confirms worker-acknowledged durability; otherwise `reading-not-kept` gives the reason. Read via read_performance: `captures` lists readings, `growth` compares them.',
    input: memoryCaptureRequestSchema,
    refusals: [],
    confirmation: (input: { readonly requestedBy: string; readonly collect?: boolean }) => ({
      summary: `Keep a memory reading of this process for ${input.requestedBy}${input.collect === true ? ', collecting first' : ''}?`,
      consequence:
        'The heap is counted by object type, which pauses the loop for about 20 ns per object, and one telemetry record is stored.',
    }),
    confirmLabel: 'Keep',
    presentation: {
      running: 'Keeping a memory reading',
      done: 'Kept a memory reading',
      many: (count) => `Kept ${count} memory readings`,
    },
    subjects: () => [],
  }),
  capture_heap_snapshot: operation('capture_heap_snapshot', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: CAPTURED,
    meaning: 'Write a heap snapshot of the main isolate to a file, with every object’s size and what retains it.',
    grammar:
      'The snapshot is the V8 `.heapsnapshot` format Chrome DevTools opens; two of them taken apart show which objects grew and what holds them. Taking it runs a full collection and pauses the process, seconds on a large heap, and holds the whole snapshot in memory beside the heap until it is written; `snapshotMs` reports the pause. Captures run one at a time; the snapshot directory keeps the newest four, and `kept` lists them newest first. `snapshot-kept` names the file, its bytes and the heap after the collection; `snapshot-failed` names the step that failed.',
    input: heapSnapshotRequestSchema,
    refusals: [],
    confirmation: (input: { readonly requestedBy: string }) => ({
      summary: `Write a heap snapshot of this process for ${input.requestedBy}?`,
      consequence:
        'The process pauses for a full collection and the snapshot, seconds on a large heap, and a file of hundreds of megabytes is written; the oldest snapshot beyond four is removed.',
    }),
    confirmLabel: 'Snapshot',
    presentation: {
      running: 'Writing a heap snapshot',
      done: 'Wrote a heap snapshot',
      many: (count) => `Wrote ${count} heap snapshots`,
    },
    subjects: () => [],
  }),
  read_performance: operation('read_performance', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: READ,
    meaning: 'Read live memory or retained performance evidence: captures/growth, stalls, spans, traces, metrics, vitals and CPU profiles.',
    grammar:
      '`type` selects the query; lists use their typed cursor and optional `since`. `ledger` reads the process-lifetime retained suffix of causal roots from memory, oldest sequence first; `rootId` selects a root and `after` takes the returned `{ledgerId,sequence}` cursor. Every page names its `ledgerId`; a cursor from another ledger restarts at the retained suffix with `reset:true`. `evicted` counts discarded roots. Root totals sum disjoint own and producer counters; ended roots can still gain late work. `statements` counts standalone Run sends, while `programStatements` counts statements and guards carried by submitted programs, including those skipped after a conflict. `unattributedStatements` counts standalone sends without a cause. Byte counters measure logical SQLite payloads, not advanced-IPC framing; the shared error of a failed program batch is charged once to the cause of its first member. A process without a ledger answers unavailable. `writer-units` reads bounded physical outer Store units by `rootId`, `operation` and instance-bound sequence cursor; it reports gaps, evictions, outcomes, physical wait/hold, child-statement elapsed, outside time and the writer-child `commitReturnedAt` epoch milliseconds. A missing child reply makes the child/outside split null. The epoch clock has no promised cross-process skew bound. `writer-metrics` pages cumulative operation histogram series; subtract only matching writerId, series and boundaries. Its p50/p99 are bucket upper bounds, not exact observations; operation eviction starts a new series. These readings are process-local and unsampled. `memory` measures RSS attribution now; `captures` lists saved censuses; `growth` compares `id` against `against` or the preceding capture.\nUse `names` to discover names for `slow` and `metrics`. Stall results include cause, covering tool call and the `sampling` of its profile: its samples inside the stall, the busy time they saw between neighbouring samples, and the frame holding the most of it, named only when that covers at least half the stall. `trace` returns a forest page, `totalSpans` and cursor; optional `spanId` selects a subtree.\n`load` folds the stored rounds of live load into a series per subject — one execution, this installation, the machine — in buckets of `stepMs`, carrying each step’s peak and mean cores, its largest resident sum and the CPU seconds integrated from the cumulative counter; `subject`, `execution` and `threadId` narrow whose rounds are counted, and a reading nobody could measure stands beside the figures instead of inside them.\n`breakdown` ranks direct children by covered elapsed time and reports their clipped interval union plus `selfMs` outside it. `overview` totals one explicit `[since, until)` interval per operation name, paging by `(name, boundaryKey)`; it is a name page, never a global slowest ranking. Evidence is retained-only: `selfMs` includes missing, sampled-out and unfinished children, not CPU time. Do not sum overlapping durations.\n`raw` on `profile` hands a thread the inspector artifact as a `.cpuprofile` file in its scratch and names it in `artifact`; a caller with no scratch gets it inside the report.\nReturns a report or typed not-found, unavailable or query-failed result; no SQL or expression language.',
    input: performanceQuerySchema,
    refusals: [],
    confirmation: (input: { readonly type: string }) => ({
      summary: `Read the ${input.type} reading of this process?`,
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading process performance',
      done: 'Read process performance',
      many: (count) => `Read process performance ${count} times`,
    },
    subjects: () => [],
  }),
  read_host_performance: operation('read_host_performance', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: READ,
    meaning:
      "Read the execution host's retained performance evidence — its vitals, stalls with their CPU profiles, spans, metrics and command costs — with the questions read_performance asks.",
    grammar:
      'Takes the same query as read_performance and answers from the host’s own ring, read beside the host without writing its files. `state` names the state directory of another host — a test host’s, a retired installation’s — whose ring is read the same way without starting it; absent, this server’s host. `memory`, `losses` and `ledger` refuse as unavailable: they are measured inside the process they describe, and the host’s store pressure rides every vital. A host whose ring does not stand yet answers unavailable.',
    input: hostPerformanceQuerySchema,
    refusals: [],
    confirmation: (input: { readonly type: string }) => ({
      summary: `Read the ${input.type} reading of the execution host?`,
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading host performance',
      done: 'Read host performance',
      many: (count) => `Read host performance ${count} times`,
    },
    subjects: () => [],
  }),
  read_watches: operation('read_watches', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { watches: WatchReading } }),
    meaning:
      'Read the filesystem watchers this server holds open now: each watched place, whether it is recursive, and how many named events and rescans it has delivered since it opened.',
    grammar: `Places come busiest first by events plus rescans, ${WATCH_ROWS.default} by default and ${WATCH_ROWS.ceiling} at most; \`total\` counts every place. A parked place is withheld while Tagma itself changes the tree under it and holds no subscription. Its \`unnamed\` rescans count each time its own subscription dropped events or reopened. Counters live with the process and start at zero on every start.`,
    input: Schema.Struct({
      limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: WATCH_ROWS.ceiling }))),
    }),
    refusals: [],
    confirmation: () => ({ summary: 'Read the filesystem watchers of this server?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading watchers', done: 'Read watchers' },
    subjects: () => [],
  }),
};

export type PerformanceOperationId = keyof typeof PERFORMANCE_OPERATIONS;
export const PERFORMANCE_OPERATION_IDS = Object.keys(PERFORMANCE_OPERATIONS) as readonly PerformanceOperationId[];
