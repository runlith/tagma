import { Effect } from 'effect';
import type { ThreadTranscript, ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import type { ThreadTranscriptQuery } from '@runlith/agent/thread/storage/aggregate';
import { TranscriptFold } from '@runlith/agent/transcript/TranscriptFold';
import type { ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { entryOf, ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import {
  markThreadEntry,
  type ThreadEntryPlacement,
  type ThreadEventFact,
  type ThreadRewindMark,
} from '@runlith/agent/transcript/eventFold';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { StoredFailure } from '../../platform/store/crossing.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { runIdOf, threadLog } from '../store/thread.js';
import { threadEntry } from '../../threads/store/kernel.js';
import { threadEvent } from '../../threads/store/journal.js';
import type { RestedFolds, RestedTranscript } from './restedFolds.js';
import { journalHead } from '../../threads/journal/base.js';
import {
  bounds,
  chunked,
  factOf,
  type FoldedFact,
  makeTranscriptRows,
  type Placed,
  storedEntry,
  takeTranscriptPage,
  type Weighed,
  weighed,
  wireWeight,
} from './rows.js';

const stillOpen = (entries: ThreadTranscript): readonly ThreadQuestionEntry[] =>
  entries.filter(entryOf('question')).filter((entry) => entry.status === 'open');

export type ThreadEntryFold = Effect.Success<ReturnType<typeof makeEntryFold>>;

export const makeEntryFold = Effect.fnUntraced(function* ({ reads }: { readonly reads: RestedFolds | undefined }) {
  const { db } = yield* MachineStore;
  const kinds = yield* ThreadEntryKinds;
  const stored = yield* makeTranscriptRows;

  const rested = (unit: Unit<'machine'>, id: string): Effect.Effect<Rested | null, StoredFailure> =>
    reads === undefined
      ? Effect.succeed(null)
      : Effect.map(reads.transcript(id, unit), (transcript) => (transcript === null ? null : { reads, transcript }));

  const served = Effect.fnUntraced(function* (
    unit: Unit<'machine'>,
    id: string,
    taken: readonly Weighed[],
    marked: ReadonlyMap<string, ThreadRewindMark | null>,
  ) {
    const ords = taken.flatMap((candidate) => (candidate.entry === undefined ? [candidate.ord] : []));
    const bodies = new Map<number, ThreadTranscriptEntry>();
    for (const chunk of chunked(ords)) {
      const rows = yield* stored.layered.rows(unit, id, inArray(threadEntry.ord, chunk));
      for (const row of rows) bodies.set(row.ord, yield* storedEntry(kinds, row.entry));
    }
    return taken.flatMap((candidate): Placed[] => {
      const body = candidate.entry ?? bodies.get(candidate.ord);
      if (body === undefined) return [];
      const mark = candidate.entry === undefined ? marked.get(body.id) : undefined;
      return [{ ord: candidate.ord, entry: mark === undefined ? body : markThreadEntry(body, mark) }];
    });
  });

  const older = (unit: Unit<'machine'>, id: string, oldest: number, pending: PendingTail): Effect.Effect<boolean, StoredFailure> => {
    const waiting = (slot: Placed): boolean => slot.ord < oldest;
    if (pending.above.some(waiting) || pending.below.some(waiting)) return Effect.succeed(true);
    return stored.layered.any(unit, id, and(...bounds(oldest, pending.withdrawn))!);
  };

  const pending = Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, facts: readonly ThreadEventFact[]) {
    const fold = new TranscriptFold(yield* stored.seedFor(unit, id, facts));
    const edge = yield* stored.edge(unit, id);
    const above = new Map<string, Placed>();
    const below = new Map<string, Placed>();
    const replaced = new Map<string, ThreadTranscriptEntry>();
    const withdrawn = new Set<string>();
    const marked = new Map<string, ThreadRewindMark | null>();
    let next = edge.high + 1;
    let first = edge.low - 1;
    for (const fact of facts) {
      const placement = fold.place(fact);
      if (placement === null) continue;
      if (placement.kind === 'mark') {
        for (const marking of placement.ids) {
          const held = above.get(marking) ?? below.get(marking);
          const replacement = replaced.get(marking);
          if (held !== undefined) held.entry = markThreadEntry(held.entry, placement.rewound);
          else if (replacement !== undefined) replaced.set(marking, markThreadEntry(replacement, placement.rewound));
          else marked.set(marking, placement.rewound);
        }
        continue;
      }
      if (placement.kind === 'withdraw') {
        for (const gone of placement.ids) {
          above.delete(gone);
          below.delete(gone);
          replaced.delete(gone);
          marked.delete(gone);
          withdrawn.add(gone);
        }
        continue;
      }
      const held = above.get(placement.entry.id) ?? below.get(placement.entry.id);
      if (placement.kind === 'replace') {
        if (held === undefined) replaced.set(placement.entry.id, placement.entry);
        else held.entry = placement.entry;
        continue;
      }
      withdrawn.delete(placement.entry.id);
      const slot = { ord: placement.kind === 'append' ? next++ : first--, entry: placement.entry };
      (placement.kind === 'append' ? above : below).set(placement.entry.id, slot);
    }
    return { above: [...above.values()], below: [...below.values()], replaced, marked, withdrawn: [...withdrawn] };
  });

  const logTail = Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string) {
    const rows = yield* unit.run(
      db
        .select({
          through: threadLog.entriesThrough,
          head: sql<number>`${journalHead(sql`${threadLog.threadId}`)}`,
          position: threadEvent.position,
          kind: threadEvent.kind,
          payload: threadEvent.payload,
        })
        .from(threadLog)
        .leftJoin(threadEvent, and(eq(threadEvent.threadId, threadLog.threadId), gt(threadEvent.position, threadLog.entriesThrough)))
        .where(eq(threadLog.threadId, id))
        .orderBy(asc(threadEvent.position)),
    );
    const log = rows[0];
    if (log !== undefined) {
      const suffix = rows.flatMap((row): LoggedEvent[] =>
        row.position === null || row.kind === null
          ? []
          : [{ position: row.position, kind: row.kind, payload: row.payload as ThreadEventPayloadValue }],
      );
      return { through: log.through, head: Number(log.head), suffix };
    }
    const newest = yield* unit.run(db.get<{ head: number }>(sql`select ${journalHead(sql`${id}`)} as head`));
    return { through: 0, head: Number(newest?.head ?? 0), suffix: [] };
  });

  return {
    layered: stored.layered,
    place: stored.place,
    seed: stored.seed,
    forget: stored.forget,
    transcript: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string) {
      const held = yield* rested(unit, id);
      if (held !== null) return yield* held.reads.entries(held.transcript);
      const rows = yield* stored.rows(unit, id);
      const suffix = yield* stored.suffix(unit, id);
      if (suffix.length === 0) return rows;
      const fold = new TranscriptFold(rows);
      for (const fact of suffix) fold.place(fact);
      return fold.take();
    }),
    ofRun: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, runId: string) {
      const held = yield* rested(unit, id);
      if (held !== null) return yield* held.reads.ofRun(held.transcript, runId);
      const seed = yield* stored.rowsOfRuns(unit, id, [runId]);
      const suffix = yield* stored.suffix(unit, id);
      if (suffix.length === 0) return seed;
      const fold = new TranscriptFold(seed);
      for (const fact of suffix) {
        const mine = fact.withdrawn
          ? fact.withdrawn.runId === runId
          : fact.rewound !== undefined || fact.restored !== undefined
            ? (fact.rewound?.runIds ?? fact.restored?.runIds ?? []).includes(runId)
            : fact.entry !== undefined && runIdOf(fact.entry) === runId;
        if (mine) fold.place(fact);
      }
      return fold.take();
    }),
    openQuestionsOfRun: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, runId: string) {
      const held = yield* rested(unit, id);
      if (held !== null) return yield* held.reads.openQuestionsOfRun(held.transcript, runId);
      const suffix = (yield* stored.suffix(unit, id)).filter((fact) =>
        fact.withdrawn
          ? fact.withdrawn.runId === runId
          : fact.rewound !== undefined || fact.restored !== undefined
            ? (fact.rewound?.runIds ?? fact.restored?.runIds ?? []).includes(runId)
            : fact.entry !== undefined && runIdOf(fact.entry) === runId && fact.entry.type === 'question',
      );
      const changed = suffix.flatMap((fact) => (fact.entry === undefined ? [] : [fact.entry.id]));
      const seed = yield* stored.openQuestionSeed(unit, id, runId, changed);
      if (suffix.length === 0) return stillOpen(seed);
      const fold = new TranscriptFold(seed);
      for (const fact of suffix) fold.place(fact);
      return stillOpen(fold.take());
    }),
    questionById: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, questionId: string) {
      const held = yield* rested(unit, id);
      const seed =
        held === null ? yield* stored.questionRowsById(unit, id, questionId) : yield* held.reads.questionById(held.transcript, questionId);
      const fold = new TranscriptFold(seed);
      if (held === null) {
        for (const fact of yield* stored.suffix(unit, id)) {
          if (
            fact.withdrawn !== undefined ||
            fact.rewound !== undefined ||
            fact.restored !== undefined ||
            (fact.entry !== undefined && entryOf('question')(fact.entry) && fact.entry.questionId === questionId)
          )
            fold.place(fact);
        }
      }
      return fold
        .take()
        .findLast((entry): entry is ThreadQuestionEntry & typeof entry => entryOf('question')(entry) && entry.questionId === questionId);
    }),
    byId: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, entryId: string) {
      const held = yield* rested(unit, id);
      if (held !== null) return yield* held.reads.byId(held.transcript, entryId);
      const row = yield* stored.rowById(unit, id, entryId);
      const suffix = yield* stored.suffix(unit, id);
      if (suffix.length === 0) return row;
      const fold = new TranscriptFold(row === undefined ? [] : [row]);
      for (const fact of suffix) {
        if (fact.withdrawn !== undefined || fact.rewound !== undefined || fact.restored !== undefined || fact.entry?.id === entryId)
          fold.place(fact);
      }
      return fold.take().find((entry) => entry.id === entryId);
    }),
    window: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, query: ThreadTranscriptQuery) {
      const held = yield* rested(unit, id);
      if (held !== null) return yield* held.reads.window(held.transcript, query);
      const suffix = yield* stored.suffix(unit, id);
      const tail = suffix.length === 0 ? NOTHING_PENDING : yield* pending(unit, id, suffix);
      const above = [...tail.above].reverse().filter((slot) => under(slot.ord, query.before));
      const below = tail.below.filter((slot) => under(slot.ord, query.before));
      const roof = above[above.length - 1]?.ord ?? query.before;
      const rows =
        above.length >= query.limit
          ? []
          : yield* stored.layered.newest(unit, id, and(...bounds(roof, tail.withdrawn)), query.limit - above.length);
      const candidates: Weighed[] = [
        ...above.map(weighed),
        ...rows.map((row) => {
          const replacement = tail.replaced.get(row.entryId);
          return replacement === undefined
            ? { ord: row.ord, weight: wireWeight(row.type, row.size) }
            : weighed({ ord: row.ord, entry: replacement });
        }),
        ...below.map(weighed),
      ].slice(0, query.limit);

      return yield* takeTranscriptPage(
        candidates,
        query,
        (taken) => served(unit, id, taken, tail.marked),
        (floor) => older(unit, id, floor, tail),
      );
    }),
    project: Effect.fnUntraced(
      function* (unit: Unit<'machine'>, id: string) {
        const { through, head, suffix } = yield* logTail(unit, id);
        yield* Effect.annotateCurrentSpan({ events: suffix.length });
        if (suffix.length === 0) return { claimed: EMPTY_IDS, head };
        const facts = yield* Effect.forEach(suffix, (event) => factOf(kinds, event.kind, event.payload));
        const seed = yield* stored.seedFor(unit, id, facts);
        const fold = new TranscriptFold(seed);
        const placements: ThreadEntryPlacement[] = [];
        const claimed = new Set<string>();
        const folded = new Map<string, FoldedFact>();
        for (const [at, fact] of facts.entries()) {
          if (fact.entry !== undefined) claimed.add(fact.entry.id);
          if (fact.branched !== undefined) continue;
          const placement = fold.place(fact);
          if (placement === null) continue;
          placements.push(placement);
          if (placement.kind === 'mark') continue;
          if (placement.kind === 'withdraw') {
            for (const gone of placement.ids) folded.delete(gone);
            continue;
          }
          const event = suffix[at];
          if (event !== undefined && entryOf('tool')(placement.entry)) {
            folded.set(placement.entry.id, { position: event.position, payload: event.payload, entry: placement.entry });
          }
        }
        yield* stored.restore(unit, id, through, seed, placements);
        const written = yield* stored.place(unit, id, placements);
        yield* stored.strip(unit, id, folded);
        yield* stored.moveCursor(unit, id, suffix[suffix.length - 1]?.position ?? through);
        yield* Effect.annotateCurrentSpan({ rows: written });
        return { claimed, head };
      },
      Effect.withSpan('ThreadStorage.suffix.replay', (_unit, id) => ({ attributes: { threadId: id, fold: 'entries' } })),
    ),
  };
});

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

export type Projected = { readonly claimed: ReadonlySet<string>; readonly head: number };

type Rested = { readonly reads: RestedFolds; readonly transcript: RestedTranscript };

type LoggedEvent = { readonly position: number; readonly kind: string; readonly payload: ThreadEventPayloadValue };

type PendingTail = {
  readonly above: readonly Placed[];
  readonly below: readonly Placed[];
  readonly replaced: ReadonlyMap<string, ThreadTranscriptEntry>;
  readonly marked: ReadonlyMap<string, ThreadRewindMark | null>;
  readonly withdrawn: readonly string[];
};

const NOTHING_PENDING: PendingTail = { above: [], below: [], replaced: new Map(), marked: new Map(), withdrawn: [] };

const under = (ord: number, before: number | undefined): boolean => before === undefined || ord < before;
