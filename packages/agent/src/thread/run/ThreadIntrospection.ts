import { utf8ByteLength } from '@runlith/utils/utf8';
import { Clock, Context, Effect, Layer } from 'effect';
import { toolFailed } from '../../transcript/entries';
import { coreEntry, ThreadEntryKinds, type ThreadEntryReader } from '../../transcript/kinds';
import {
  readThreadEvents,
  readThreadRecordEvidenceAsOf,
  readThreadRevisionEvidenceAsOf,
  type ThreadEventPayload,
  type ThreadEventRecord,
  type ThreadEventUnavailable,
} from '../events';
import type { ThreadMetadataRow, ThreadRunRow } from '../rows';
import {
  THREAD_QUERY_ADDRESS,
  THREAD_QUERY_DEFAULT_FIELDS,
  ThreadQueryFold,
  grouped,
  matchesThreadQuery,
  compareThreadRowRanks,
  threadRowRank,
  type RankedThreadQueryRow,
  type ThreadQueryOrder,
  projectThreadRow,
  recordFacets,
  threadRecordOrigin,
  type ThreadKernelSource,
  type ThreadQuery,
  type ThreadQueryCoverage,
  type ThreadQueryGroup,
  type ThreadQueryRow,
} from '../ThreadQuery';
import { ThreadEventJournal, ThreadStore } from '../ThreadPorts';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadRunLedger } from './ThreadRunLedger';
const RECORDS_PER_READ = 500;
const ROW_BYTES_PER_PAGE = 512 * 1024;
export const RECORDS_PER_QUERY = 30_000;
export type ThreadSessionRow = ThreadMetadataRow & {
  readonly systemPrompt: string | null;
};
export type ThreadSessionShape = {
  readonly thread: ThreadSessionRow;
  readonly entries: number;
  readonly runs: readonly ThreadRunRow[];
};
export type ThreadLogWindow = {
  readonly after: number;
  readonly through: number;
  readonly head: number;
  readonly records: readonly ThreadEventRecord[];
};
export type ThreadLogWindowInput = {
  readonly after: number;
  readonly limit: number;
  readonly kinds?: readonly string[];
};
export type ThreadQueryTarget = {
  readonly threadId: string;
  readonly head: number;
  readonly runs: readonly ThreadQueryRow[];
};
export type ThreadQueryStop =
  | {
      readonly kind: 'source';
      readonly at: number;
      readonly sourceKey: string | null;
    }
  | {
      readonly kind: 'result';
      readonly at: number;
    };
export type ThreadQueryInput = {
  readonly query: ThreadQuery & {
    readonly select: ThreadKernelSource;
  };
  readonly targets: readonly ThreadQueryTarget[];
  readonly from?: ThreadQueryStop;
  readonly seed?: readonly ThreadQueryGroup[];
};
export type ThreadQueryAnswer = {
  readonly rows: readonly ThreadQueryRow[];
  readonly groups?: readonly ThreadQueryGroup[];
  readonly coverage: ThreadQueryCoverage;
  readonly next: ThreadQueryStop | null;
};
export class ThreadIntrospection extends Context.Service<
  ThreadIntrospection,
  {
    shape(threadId: string): Effect.Effect<ThreadSessionShape, ThreadBorderFailed>;
    window(threadId: string, input: ThreadLogWindowInput): Effect.Effect<ThreadLogWindow, ThreadBorderFailed>;
    pin(threadId: string): Effect.Effect<ThreadQueryTarget, ThreadBorderFailed>;
    query(input: ThreadQueryInput): Effect.Effect<ThreadQueryAnswer, ThreadBorderFailed>;
    entryAt(threadId: string, position: number): Effect.Effect<ThreadEventRecord | null, ThreadBorderFailed>;
    entryNamed(threadId: string, recordId: string): Effect.Effect<ThreadEventRecord | null, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadIntrospection') {}
export const makeThreadIntrospection = Effect.gen(function* () {
  const journal = yield* ThreadEventJournal;
  const entryKinds = yield* ThreadEntryKinds;
  const ledger = yield* ThreadRunLedger;
  const store = yield* ThreadStore;
  const entryAt = (threadId: string, position: number): Effect.Effect<ThreadEventRecord | null, ThreadBorderFailed> =>
    position < 1
      ? Effect.succeed(null)
      : readThreadEvents(journal, entryKinds, threadId, position - 1, 1).pipe(
          Effect.map((rows) => rows.find((row) => row.position === position) ?? null),
        );
  return ThreadIntrospection.of({
    shape: Effect.fn('ThreadIntrospection.shape')(function* (threadId) {
      const [thread, prompt, entries, runs] = yield* Effect.all(
        [store.metadata(threadId), store.systemPromptOf(threadId), journal.headPosition(threadId), ledger.runsOf(threadId)],
        { concurrency: 'unbounded' },
      );
      if (!thread) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });
      return { thread: { ...thread, systemPrompt: prompt?.systemPrompt ?? null }, entries, runs };
    }),
    window: Effect.fn('ThreadIntrospection.window')(function* (threadId, input) {
      const head = yield* journal.headPosition(threadId);
      const rows = yield* readThreadEvents(journal, entryKinds, threadId, input.after, input.limit);
      const kinds = input.kinds;
      const kept = kinds === undefined ? rows : rows.filter((row) => kinds.includes(row.kind));
      return {
        after: input.after,
        through: rows.at(-1)?.position ?? input.after,
        head,
        records: kept,
      };
    }),
    pin: Effect.fn('ThreadIntrospection.pin')(function* (threadId) {
      const [head, runs] = yield* Effect.all([journal.headPosition(threadId), ledger.runsOf(threadId)], {
        concurrency: 'unbounded',
      });
      const asOf = new Date(yield* Clock.currentTimeMillis).toISOString();
      return { threadId, head, runs: runs.map((run) => runRow(threadId, run, asOf)) };
    }),
    query: (input) => runQuery(journal, entryKinds, input),
    entryAt,
    entryNamed: (threadId, recordId) =>
      journal.positionOf(threadId, recordId).pipe(
        Effect.flatMap((position) => (position === null ? Effect.succeed(null) : entryAt(threadId, position))),
        Effect.withSpan('ThreadIntrospection.entryNamed'),
      ),
  });
});

export const threadIntrospectionLayer = Layer.effect(ThreadIntrospection, makeThreadIntrospection);

const runQuery = Effect.fn('ThreadIntrospection.query')(function* (
  journal: Context.Service.Shape<typeof ThreadEventJournal>,
  entryKinds: ThreadEntryReader,
  input: ThreadQueryInput,
): Effect.fn.Return<ThreadQueryAnswer, ThreadBorderFailed> {
  const { query, targets } = input;
  const aggregate = grouped(query);
  const order = aggregate ? undefined : query.order;
  const wholePopulation = aggregate || order !== undefined;
  const fold = aggregate ? new ThreadQueryFold(query, input.seed) : null;
  const fields = query.fields ?? THREAD_QUERY_DEFAULT_FIELDS[query.select];
  const wanted = query.limit ?? RECORDS_PER_READ;
  const shown = input.from?.kind === 'result' ? input.from.at : 0;
  const source = input.from?.kind === 'source' ? input.from : undefined;
  const held = wholePopulation && query.limit === undefined ? null : shown + wanted;
  const kept: ThreadQueryRow[] = [];
  const ranking: RankedThreadQueryRow[] = [];
  const unavailable: string[] = [];
  let read = 0;
  let matched = 0;
  let bytes = 0;
  let next: ThreadQueryStop | null = null;
  let cut = false;
  for (let at = source?.at ?? 0; at < targets.length; at += 1) {
    const target = targets[at];
    if (target === undefined) continue;
    let key = at === source?.at ? source.sourceKey : null;
    let after = query.select === 'runs' ? (key === null ? -1 : target.runs.findIndex((run) => run.runId === key)) : Number(key ?? 0);
    let budget = Math.max(1, Math.min(wholePopulation ? RECORDS_PER_READ : wanted, RECORDS_PER_READ));
    for (;;) {
      const batch = yield* readSource(journal, entryKinds, query, target, after, budget);
      budget = Math.min(budget * 4, RECORDS_PER_READ);
      let filled = false;
      const pending: RankedThreadQueryRow[] = [];
      for (const item of batch.items) {
        if (item._tag === 'Unavailable') {
          key = String(item.evidence.position);
          unavailable.push(unavailableRecord(item.evidence));
          continue;
        }
        const row = item.row;
        key = sourceKeyOf(query, row) ?? key;
        read += 1;
        if (matchesThreadQuery(row, query.where)) {
          matched += 1;
          if (fold !== null) {
            fold.take(row);
          } else if (order !== undefined) {
            const candidate: RankedThreadQueryRow = { row, rank: threadRowRank(row, order) };
            ranking.push(candidate);
            pending.push(candidate);
          } else {
            const projected = projectThreadRow(row, fields, THREAD_QUERY_ADDRESS[query.select]);
            kept.push(projected);
            if (!wholePopulation) bytes += weigh(projected);
          }
        }
        if (!wholePopulation && (kept.length >= wanted || bytes >= ROW_BYTES_PER_PAGE)) {
          filled = true;
          break;
        }
        if (read >= RECORDS_PER_QUERY) {
          cut = true;
          filled = true;
          break;
        }
      }
      if (order !== undefined) {
        const trimmed = held !== null && ranking.length > held * 4;
        if (trimmed) trim(ranking, order, held);
        const retained = trimmed ? new Set(ranking) : null;
        for (const candidate of pending) {
          if (retained === null || retained.has(candidate))
            candidate.row = projectThreadRow(candidate.row, fields, THREAD_QUERY_ADDRESS[query.select]);
        }
      }
      if (filled) {
        next = { kind: 'source', at, sourceKey: key };
        break;
      }
      if (batch.done) break;
      after = query.select === 'runs' ? after + batch.items.length : Number(key ?? 0);
    }
    if (next !== null) break;
  }
  if (fold !== null) {
    const answered = fold.answer(query.limit, shown);
    if (cut) {
      return {
        rows: [],
        groups: answered.groups,
        coverage: { complete: false, unavailable, truncated: answered.more, read, cut: 'read-ceiling' },
        next,
      };
    }
    return {
      rows: [],
      groups: answered.groups,
      coverage: { complete: true, unavailable, truncated: answered.more, read },
      next: answered.more ? { kind: 'result', at: shown + answered.groups.length } : null,
    };
  }
  if (order !== undefined) {
    const all = ranking.sort((left, right) => compareThreadRowRanks(left.rank, right.rank, order)).map(({ row }) => row);
    if (cut) {
      const shownRows = held === null ? all : all.slice(shown, held);
      return {
        rows: shownRows,
        coverage: { complete: false, unavailable, truncated: true, read, cut: 'read-ceiling' },
        next,
      };
    }
    if (held === null) return { rows: all, coverage: { complete: true, unavailable, truncated: false, read }, next: null };
    const more = matched > held;
    return {
      rows: all.slice(shown, held),
      coverage: { complete: true, unavailable, truncated: more, read },
      next: more ? { kind: 'result', at: held } : null,
    };
  }
  return {
    rows: kept,
    coverage: {
      complete: next === null,
      unavailable,
      truncated: next !== null,
      read,
      cut: cut ? ('read-ceiling' as const) : undefined,
    },
    next,
  };
});
function weigh(row: ThreadQueryRow): number {
  return utf8ByteLength(JSON.stringify(row) ?? '');
}
function trim(rows: RankedThreadQueryRow[], order: ThreadQueryOrder, wanted: number): void {
  rows.sort((left, right) => compareThreadRowRanks(left.rank, right.rank, order));
  rows.length = Math.min(rows.length, wanted);
}
type SourceItem =
  | {
      readonly _tag: 'Available';
      readonly row: ThreadQueryRow;
    }
  | {
      readonly _tag: 'Unavailable';
      readonly evidence: ThreadEventUnavailable;
    };
type SourceBatch = {
  readonly items: readonly SourceItem[];
  readonly done: boolean;
};
function sourceKeyOf(query: ThreadQuery, row: ThreadQueryRow): string | null {
  const held = query.select === 'runs' ? row.runId : row.at;
  return held === undefined || held === null ? null : String(held);
}
function unavailableRecord(evidence: ThreadEventUnavailable): string {
  return `threadId=${evidence.threadId} at=${evidence.position} family=${evidence.family} — ${evidence.reason}`;
}
function readSource(
  journal: Context.Service.Shape<typeof ThreadEventJournal>,
  entryKinds: ThreadEntryReader,
  query: ThreadQuery & {
    readonly select: ThreadKernelSource;
  },
  target: ThreadQueryTarget,
  after: number,
  budget: number,
): Effect.Effect<SourceBatch, ThreadBorderFailed> {
  if (query.select === 'runs') {
    const end = after + 1 + budget;
    return Effect.succeed({
      items: target.runs.slice(after + 1, end).map((row) => ({ _tag: 'Available' as const, row })),
      done: end >= target.runs.length,
    });
  }
  const kinds = kindsOf(query);
  const window = {
    head: target.head,
    afterPosition: Number.isFinite(after) ? after : 0,
    limit: budget,
    kinds: kinds,
  };
  const ledger = runLedger(target);
  if (query.select === 'entries') {
    return Effect.map(readThreadRevisionEvidenceAsOf(journal, entryKinds, target.threadId, window), (revisions) => ({
      items: revisions.map((revision): SourceItem =>
        revision._tag === 'Unavailable'
          ? revision
          : {
              _tag: 'Available',
              row: entryRow(
                target.threadId,
                revision.record.position,
                revision.record.id,
                revision.record.identity,
                revision.record.payload,
                ledger,
              ),
            },
      ),
      done: revisions.length < budget,
    }));
  }
  return Effect.map(readThreadRecordEvidenceAsOf(journal, entryKinds, target.threadId, window), (records) => ({
    items: records.map((record): SourceItem =>
      record._tag === 'Unavailable'
        ? record
        : {
            _tag: 'Available',
            row: recordShapedRow(
              query.select,
              target.threadId,
              record.record.position,
              record.record.id,
              record.record.kind,
              record.record.payload,
              ledger,
            ),
          },
    ),
    done: records.length < budget,
  }));
}
export type ThreadRunLedgerView = {
  readonly own: ReadonlySet<string>;
  readonly of: (runId: string) =>
    | {
        provider: unknown;
        model: unknown;
        reasoning: unknown;
      }
    | undefined;
};
function runLedger(target: ThreadQueryTarget): ThreadRunLedgerView {
  const byId = new Map(target.runs.map((run) => [String(run.runId), run]));
  return {
    own: new Set(byId.keys()),
    of: (runId) => {
      const run = byId.get(runId);
      return run === undefined ? undefined : { provider: run.provider, model: run.model, reasoning: run.reasoning };
    },
  };
}
function kindsOf(query: ThreadQuery): readonly string[] | undefined {
  if (query.select === 'steps') return ['step-finished'];
  if (query.select === 'measurements') return ['measurement'];
  for (const predicate of query.where ?? []) {
    if (predicate.field !== 'kind') continue;
    if (predicate.op === 'eq' && typeof predicate.value === 'string') return [predicate.value];
    if (predicate.op === 'in' && Array.isArray(predicate.value)) {
      return predicate.value.filter((value): value is string => typeof value === 'string');
    }
  }
  return undefined;
}
export function runRow(threadId: string, run: ThreadRunRow, asOf: string): ThreadQueryRow {
  return {
    threadId,
    runId: run.id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    reasoning: run.reasoning,
    account: run.account,
    usage: run.usage,
    approvalMode: run.approvalMode,
    interactive: run.interactive,
    resumes: run.resumes,
    failureReason: run.failureReason,
    failure: run.failure,
    settledBy: run.settledBy,
    settledNotifyAttempts: run.settledNotifyAttempts,
    settledNotifiedAt: run.settledNotifiedAt?.toISOString() ?? null,
    settledNotification: run.settledNotification,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt.toISOString(),
    heartbeatAt: run.heartbeatAt.toISOString(),
    handedOverAt: run.handedOverAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    asOf,
  };
}
function recordShapedRow(
  select: ThreadKernelSource,
  threadId: string,
  position: number,
  eventId: string,
  kind: string,
  payload: ThreadEventPayload,
  ledger: ThreadRunLedgerView,
): ThreadQueryRow {
  if (select === 'steps') {
    const context = payload.context;
    return {
      threadId,
      at: position,
      runId: context?.runId ?? null,
      stepNumber: context?.stepNumber ?? null,
      activity: context?.activity ?? null,
      provider: context?.provider ?? null,
      model: context?.model ?? null,
      usage: payload.usage ?? null,
      contextWindow: context?.contextWindow ?? null,
      inputLimit: context?.inputLimit ?? null,
      measuredAt: context?.measuredAt ?? null,
    };
  }
  if (select === 'measurements') {
    const measurement = payload.measurement;
    return {
      threadId,
      at: position,
      runId: measurement?.runId ?? null,
      stepNumber: measurement?.stepNumber ?? null,
      attempt: measurement?.attempt ?? null,
      activity: measurement?.activity ?? null,
      provider: measurement?.provider ?? null,
      model: measurement?.model ?? null,
      usage: measurement?.usage ?? null,
      contextWindow: measurement?.contextWindow ?? null,
      inputLimit: measurement?.inputLimit ?? null,
      measuredAt: measurement?.measuredAt ?? null,
      footprint: measurement?.footprint ?? null,
    };
  }
  return {
    threadId,
    at: position,
    id: eventId,
    kind,
    origin: threadRecordOrigin(payload, ledger.own),
    ...recordFacets(payload),
  };
}
function entryRow(
  threadId: string,
  position: number,
  eventId: string,
  identity: string,
  payload: ThreadEventPayload,
  ledger: ThreadRunLedgerView,
): ThreadQueryRow {
  const entry = payload.entry;
  const core = entry !== undefined && coreEntry(entry) ? entry : undefined;
  const tool = core?.type === 'tool' ? core : undefined;
  const signal = core?.type === 'signal' ? core : undefined;
  const toolState = tool?.toolState ?? null;
  const runId = entry?.runId ?? null;
  const origin = threadRecordOrigin(payload, ledger.own);
  const ran = origin === 'own' && runId !== null ? ledger.of(runId) : undefined;
  return {
    threadId,
    at: position,
    id: eventId,
    identity,
    entryId: entry?.id ?? null,
    kind: entry?.type ?? null,
    runId,
    origin,
    provider: ran?.provider ?? null,
    model: ran?.model ?? null,
    reasoning: ran?.reasoning ?? null,
    occurredAt: entry?.occurredAt ?? null,
    role: core?.type === 'message' ? core.role : null,
    text: core !== undefined && 'text' in core ? core.text : null,
    toolName: tool?.toolName ?? null,
    toolCallId: tool?.toolCallId ?? null,
    toolState,
    failed: toolState === null ? null : toolFailed(toolState),
    signalType: signal?.signalType ?? null,
    addressee: signal?.addressee ?? null,
    sender: signal?.title ?? null,
    entry,
  };
}
