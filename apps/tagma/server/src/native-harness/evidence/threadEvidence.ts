import { Clock, Context, Effect } from 'effect';
import { threadNotification } from '@runlith/agent/thread/storage/settlement';
import { SETTLEMENT_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import type { ThreadEventRecord } from '@runlith/agent/thread/events';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { entryOf } from '@runlith/agent/transcript/kinds';
import { threadPagePayload } from '@runlith/agent/protocol/http';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { NATIVE_HARNESS, sessionName, SessionIdentity } from '../../platform/contract/wire/session.js';
import { BlockNames } from '../../graph/contract/service/acts.js';
import { GraphJournal } from '../../graph/contract/service/journal.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { SessionRead } from '../../threads/contract/service/harness.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { threadCopies } from './copies.js';
import { EvidenceFeed, ThreadEvidence, type PresenceSource, type ThreadActSummary } from '../../threads/contract/service/evidence.js';
import { gatedByProject } from '../../threads/birth/projectGate.js';
import { gated } from '../../threads/projectGate.js';
import { ThreadLookup, ThreadWindows } from '../../threads/contract/service/reads.js';
import { ContextLimits } from '../../threads/contract/service/limits.js';
import type { NativeThreadRows } from '../rows/native.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { DEFAULT_TITLE } from '../../thread-record/contract/wire/title.js';
import { ThreadRollouts } from '../../threads/contract/service/rollouts.js';
import { RestedRollouts } from '../../threads/contract/service/rested.js';
import { retainedToolValue } from '../contract/wire/toolResult.js';
import { ToolOutputs } from '../contract/service/toolOutputs.js';
import type { ThreadRunStore } from '../runs/ledger.js';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { ThreadInputRefused, type HarnessFailure } from '../../threads/contract/service/failure.js';
import { evidenceReading } from './reading.js';
import type { StatusRowOnTheWire } from '../../threads/contract/wire/statuses.js';
import type { EndingRowOnTheWire } from '../../threads/contract/wire/endings.js';

const ACTS_READ_BOUND = 2_000;
const PRESENCE_READS = 3;

type Summary = Extract<PresenceSource, { readonly outcome: 'found' }>['summary'];

export type EvidenceTargets = { readonly threads: readonly string[] };

export type ThreadEvidenceInput = { readonly rows: NativeThreadRows; readonly runs: ThreadRunStore };

export const threadEvidence = Effect.fnUntraced(function* ({ rows, runs }: ThreadEvidenceInput) {
  const harness = yield* ThreadHarness;
  const lookup = yield* ThreadLookup;
  const windows = yield* ThreadWindows;
  const records = yield* ThreadRecords;
  const sessionOf = yield* SessionRead;
  const copies = yield* threadCopies;
  const rollouts = yield* ThreadRollouts;
  const rested = yield* RestedRollouts;
  const outputs = (yield* ToolOutputs).store;
  const identity = yield* SessionIdentity;
  const limits = yield* ContextLimits;

  const opened = <A, R>(
    threadId: string,
    projectId: number,
    work: () => Effect.Effect<A, HarnessFailure, R>,
  ): Effect.Effect<A, HarnessFailure, R> =>
    rollouts.using(
      threadId,
      gatedByProject(lookup, threadId, projectId, () => work()),
    );

  const resolveEntry = Effect.fnUntraced(function* (
    threadId: string,
    entry: ThreadTranscriptEntry,
  ): Effect.fn.Return<ThreadTranscriptEntry> {
    if (!entryOf('tool')(entry)) return entry;
    const pointer = retainedToolValue(entry.toolOutput);
    if (pointer === null) return entry;
    const answer = yield* outputs.retained(threadId, pointer.outputId);
    return {
      ...entry,
      toolOutput: 'value' in answer ? answer.value : { ...pointer, unavailable: answer.unavailable },
    };
  });

  const resolveRecord = (threadId: string, record: ThreadEventRecord): Effect.Effect<ThreadEventRecord> =>
    record.payload.entry === undefined
      ? Effect.succeed(record)
      : Effect.map(resolveEntry(threadId, record.payload.entry), (entry) => ({
          ...record,
          payload: { ...record.payload, entry },
        }));

  const acts = Effect.fnUntraced(function* (threadId: string, projectId: number): Effect.fn.Return<ThreadActSummary, HarnessFailure> {
    let name: string | null = null;
    let entries = 0;
    let bounded = false;
    const blocks = new Set<string>();
    for (const graph of yield* copies(threadId, projectId, null)) {
      const sessions = Context.get(graph, WriterRegister);
      const sessionId = yield* sessions.idOf({ harness: NATIVE_HARNESS, key: threadId });
      if (sessionId === null) continue;
      const row = yield* sessions.byId(sessionId);
      name ??= row === undefined ? threadId : sessionName(row, identity);
      const written = yield* Context.get(graph, GraphJournal).events({ sessions: [sessionId], limit: ACTS_READ_BOUND });
      entries += written.length;
      bounded ||= written.length === ACTS_READ_BOUND;
      const named = yield* Context.get(graph, BlockNames).namesOf(
        written.flatMap((entry) => (entry.blockId === null ? [] : [entry.blockId])),
      );
      for (const block of named.values()) blocks.add(block);
    }
    return { name, entries, blocks: [...blocks], bounded };
  });

  const owned = Effect.fnUntraced(function* (threadIds: readonly string[], projectId: number) {
    const ids = [...new Set(threadIds)];
    const owners = yield* records.projectsOf(ids);
    const missing = new Map<string, { readonly threadId: string; readonly outcome: 'not-found' | 'foreign-project' }>();
    const present: string[] = [];
    for (const threadId of ids) {
      const owner = owners.get(threadId);
      if (owner === undefined || owner === null) missing.set(threadId, { threadId, outcome: 'not-found' });
      else if (owner !== projectId) missing.set(threadId, { threadId, outcome: 'foreign-project' });
      else present.push(threadId);
    }
    return { missing, present };
  });

  const sourcesOf = Effect.fnUntraced(function* (
    summaries: readonly Summary[],
  ): Effect.fn.Return<readonly PresenceSource[], HarnessFailure> {
    const statused = new Map(
      (yield* harness.reads.statuses(
        OPERATOR_PRINCIPAL,
        summaries.map((summary) => summary.id),
      )).flatMap((row) => (row.outcome === 'found' ? [[row.threadId, row.status] as const] : [])),
    );
    return summaries.map((summary): PresenceSource => {
      const status = statused.get(summary.id);
      return status === undefined
        ? { threadId: summary.id, outcome: 'not-found' }
        : { threadId: summary.id, outcome: 'found', summary, status };
    });
  });

  const coherent = (source: PresenceSource): boolean =>
    source.outcome !== 'found' || source.status.runId === (source.summary.activeRun?.id ?? null);

  const coherently = Effect.fnUntraced(function* (
    read: () => Effect.Effect<readonly PresenceSource[], HarnessFailure>,
  ): Effect.fn.Return<readonly PresenceSource[], HarnessFailure> {
    for (let attempt = 0; attempt < PRESENCE_READS; attempt += 1) {
      const sources = yield* read();
      if (sources.every(coherent)) return sources;
    }
    return yield* new ThreadCallBroke({ cause: new Error('A thread changed its run during every attempt to read its presence.') });
  });

  const presence = Effect.fnUntraced(function* (
    threadIds: readonly string[],
    projectId: number,
  ): Effect.fn.Return<readonly PresenceSource[], HarnessFailure> {
    const { missing, present } = yield* owned(threadIds, projectId);
    const answered = new Map<string, PresenceSource>(missing);
    if (present.length > 0) {
      const read = yield* coherently(() =>
        Effect.flatMap(windows.list(OPERATOR_PRINCIPAL, { id: projectId, projects: [projectId] }, { view: 'all', ids: present }), (page) =>
          sourcesOf(page.rows),
        ),
      );
      for (const source of read) answered.set(source.threadId, source);
    }
    return threadIds.map((threadId) => answered.get(threadId) ?? { threadId, outcome: 'not-found' as const });
  });

  const thread = ThreadEvidence.of({
    snapshot: (threadId, projectId) => opened(threadId, projectId, () => harness.reads.snapshot(threadId)),

    statuses: Effect.fnUntraced(function* (threadIds, projectId) {
      const { missing, present } = yield* owned(threadIds, projectId);
      const answered = new Map<string, StatusRowOnTheWire>(missing);
      const kernel = yield* harness.reads.statuses(OPERATOR_PRINCIPAL, present);
      const unseated: string[] = [];
      for (const row of kernel) {
        if (row.outcome === 'found') answered.set(row.threadId, { threadId: row.threadId, outcome: 'found', status: row.status });
        else unseated.push(row.threadId);
      }
      if (unseated.length > 0) {
        for (const source of yield* presence(unseated, projectId)) {
          answered.set(
            source.threadId,
            source.outcome === 'found'
              ? { threadId: source.threadId, outcome: 'found', status: source.status }
              : { threadId: source.threadId, outcome: source.outcome },
          );
        }
      }
      return threadIds.map((threadId) => answered.get(threadId) ?? { threadId, outcome: 'not-found' as const });
    }),

    presence,

    presenceOne: (threadId, projectId) =>
      Effect.map(
        coherently(() =>
          Effect.flatMap(lookup.summary(threadId), (summary): Effect.Effect<readonly PresenceSource[], HarnessFailure> => {
            if (summary === undefined || summary.ownerId !== OPERATOR_PRINCIPAL)
              return Effect.succeed([{ threadId, outcome: 'not-found' }]);
            if (summary.projectId !== projectId) return Effect.succeed([{ threadId, outcome: 'foreign-project' }]);
            return sourcesOf([summary]);
          }),
        ),
        (read): PresenceSource => read[0] ?? { threadId, outcome: 'not-found' },
      ),

    endings: Effect.fnUntraced(function* (threadIds, projectId, depth) {
      const { missing, present } = yield* owned(threadIds, projectId);
      const answered = new Map<string, EndingRowOnTheWire>(missing);
      type Ending = Effect.Success<ReturnType<typeof harness.reads.newestEndings>>[number];
      const wired = (ending: Ending) => ({ ...ending, finishedAt: ending.finishedAt.toISOString() });
      const byThread = new Map<string, ReturnType<typeof wired>[]>();
      for (const ending of yield* harness.reads.newestEndings(present, depth)) {
        byThread.set(ending.threadId, [...(byThread.get(ending.threadId) ?? []), wired(ending)]);
      }
      for (const threadId of present) answered.set(threadId, { threadId, outcome: 'found', endings: byThread.get(threadId) ?? [] });
      return threadIds.map((threadId) => answered.get(threadId) ?? { threadId, outcome: 'not-found' as const });
    }),

    shape: (threadId, projectId) =>
      opened(threadId, projectId, () =>
        Effect.gen(function* () {
          const [shape, facts, facet, cursor] = yield* Effect.all(
            [harness.reads.shape(threadId), records.facts(threadId), sessionOf(threadId), rows.graphCursor(threadId)],
            { concurrency: 'unbounded' },
          );
          const now = new Date(yield* Clock.currentTimeMillis);
          return {
            shape: { ...shape, runs: shape.runs.map((run) => ({ ...run, notification: threadNotification(run, SETTLEMENT_RHYTHM, now) })) },
            facet: {
              title: facts?.title ?? DEFAULT_TITLE,
              harness: facet,
              projectId,
              scope: cursor?.scopeBlockUuid == null ? null : blockName(cursor.scopeBlockUuid),
            },
            acts: yield* acts(threadId, projectId),
          };
        }),
      ),

    composition: (threadId, projectId) =>
      opened(threadId, projectId, () =>
        Effect.gen(function* () {
          yield* rested.readable(threadId);
          const [reading, summary] = yield* Effect.all([harness.reads.composition(threadId), lookup.summary(threadId)], {
            concurrency: 'unbounded',
          });
          const table = summary === undefined ? null : yield* limits.of([summary]);
          return { ...reading, limit: table?.get(threadId) ?? null };
        }),
      ),

    held: (threadId, projectId) =>
      gated(records, threadId, projectId, () =>
        Effect.map(harness.threads.handle(threadId, OPERATOR_PRINCIPAL).held(), (held) => ({ held })),
      ),

    entry: (threadId, projectId, entryId) =>
      opened(threadId, projectId, () =>
        Effect.flatMap(harness.reads.entryNamed(threadId, entryId), (record): Effect.Effect<{ entry: ThreadTranscriptEntry } | null> =>
          record?.payload.entry === undefined
            ? Effect.succeed(null)
            : Effect.map(resolveEntry(threadId, record.payload.entry), (entry) => ({ entry })),
        ),
      ),

    entries: (threadId, projectId, before) =>
      opened(threadId, projectId, () => Effect.map(harness.reads.page(threadId, before), threadPagePayload)),

    text: (threadId, projectId, entryId, from, limit) =>
      opened(threadId, projectId, () => harness.reads.text(threadId, entryId, from, limit)),

    attachFrom: (threadId, projectId, since) => opened(threadId, projectId, () => harness.reads.attachFrom(threadId, since)),

    rewindActs: (threadId, projectId, runIds) =>
      opened(threadId, projectId, () =>
        Effect.gen(function* () {
          const named = new Set(runIds);
          const windows = (yield* runs.runsOf(threadId)).flatMap((run) =>
            named.has(run.id) ? [{ from: run.startedAt.getTime(), to: run.finishedAt?.getTime() ?? Number.POSITIVE_INFINITY }] : [],
          );
          if (windows.length === 0) return { acts: [], bounded: false };
          const earliest = Math.min(...windows.map((window) => window.from));
          const found: { readonly op: string; readonly block: string | null; readonly ts: Date }[] = [];
          let bounded = false;
          for (const graph of yield* copies(threadId, projectId, runIds)) {
            const sessionId = yield* Context.get(graph, WriterRegister).idOf({ harness: NATIVE_HARNESS, key: threadId });
            if (sessionId === null) continue;
            const entries = yield* Context.get(graph, GraphJournal).events({ projectId, sessions: [sessionId], limit: ACTS_READ_BOUND });
            const oldest = entries[entries.length - 1]?.ts.getTime();
            bounded ||= entries.length === ACTS_READ_BOUND && oldest !== undefined && oldest >= earliest;
            const inside = entries.filter((entry) =>
              windows.some((window) => entry.ts.getTime() >= window.from && entry.ts.getTime() <= window.to),
            );
            const names = yield* Context.get(graph, BlockNames).namesOf(
              inside.flatMap((entry) => (entry.blockId === null ? [] : [entry.blockId])),
            );
            for (const entry of inside) {
              found.push({ op: entry.op, block: entry.blockId === null ? null : (names.get(entry.blockId) ?? null), ts: entry.ts });
            }
          }
          return {
            acts: found
              .toSorted((left, right) => left.ts.getTime() - right.ts.getTime())
              .map((entry) => ({ op: entry.op, block: entry.block, at: entry.ts.toISOString() })),
            bounded,
          };
        }),
      ),
  });
  const queries = yield* evidenceReading({ runs, gate: { opened, resolveRecord, retainedSlice: outputs.slice } });

  const feed = EvidenceFeed.of({
    subscribe: (threadId, listener) => harness.reads.subscribe(threadId, listener),
    view: (threadId) => harness.reads.openView(threadId),
  });

  return { thread, queries, feed };
});
