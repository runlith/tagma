import { stat } from 'node:fs/promises';
import { Data, Effect, Result } from 'effect';
import { eq, sql } from 'drizzle-orm';
import type { ThreadEventPayload } from '@runlith/agent/thread/events';
import { threadEventFact, transcriptFact } from '@runlith/agent/thread/ThreadEventDoor';
import type {
  ThreadEventPayloadValue,
  ThreadEventRevision,
  ThreadEventRow,
  ThreadRecordWindow,
} from '@runlith/agent/thread/storage/eventLog';
import type { ThreadEventFact } from '@runlith/agent/transcript/eventFold';
import { ThreadStorageFailed, decodeThreadEventPayloadResult } from '@runlith/agent/thread/persisted';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { recordFacts } from '../../thread-record/facts.js';
import { restedAtOf } from '../rest.js';
import { eventIdentity } from './foldedFacts.js';
import {
  fileSize,
  lineStartFrom,
  readRolloutLine,
  type RolloutEvent,
  rolloutEventOf,
  wholeLinesAfter,
  wholeLinesBefore,
  wholeLinesOf,
} from './rolloutFile.js';
import { ROLLOUT_SUFFIX, rolloutStateOf, streamedRollout } from './rolloutForms.js';
import { revived } from './rolloutMeta.js';
import type { RolloutForms } from './rolloutForming.js';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { journalProjectOf, threadPublishedSource, threadRolloutForm } from '../store/journal.js';
import { sourceFiles } from './sourceFiles.js';
import type { SourcePublisher } from './sourcePublisher.js';
import { RestedRollouts, type RolloutRange } from '../contract/service/rested.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';

type Latest = { readonly identity: string; readonly position: number; readonly kind: string; readonly start: number };

type Indexed = { readonly standing: string; readonly head: number; readonly latest: readonly Latest[]; touched: number };

//! A walk pages one pinned head, so the latest revisions are found once per walk rather than once per page; a handful of walks run at once.
const INDEXED_THREADS = 8;

export const makeRestedReads = Effect.fnUntraced(function* ({
  forms,
  home,
  lagging,
  sources,
}: {
  readonly forms: RolloutForms;
  readonly sources: SourcePublisher;
  readonly home: string | undefined;
  readonly lagging: (threadId: string) => void;
}) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const decode: PayloadDecode = (thread, value) => decodeThreadEventPayloadResult(kinds, thread, value);
  const indexed = new Map<string, Indexed>();
  let clock = 0;
  const facetById = db
    .select({ journal: journalProjectOf(recordFacts.id, recordFacts.projectId), evictedAt: restedAtOf(recordFacts.id) })
    .from(recordFacts)
    .where(eq(recordFacts.id, sql.placeholder('threadId')))
    .prepare();
  const rolloutById = db
    .select({
      journal: journalProjectOf(recordFacts.id, recordFacts.projectId),
      evictedAt: restedAtOf(recordFacts.id),
      source: threadPublishedSource,
      form: threadRolloutForm.step,
      publishing: threadRolloutForm.publishing,
    })
    .from(recordFacts)
    .leftJoin(threadPublishedSource, eq(threadPublishedSource.threadId, recordFacts.id))
    .leftJoin(threadRolloutForm, eq(threadRolloutForm.threadId, recordFacts.id))
    .where(eq(recordFacts.id, sql.placeholder('threadId')))
    .prepare();

  const facet = (threadId: string, tx?: Unit<'machine'>) => {
    const read = (unit: Unit<'machine'>) => unit.run(facetById.get({ threadId }));
    return Effect.map(tx ? read(tx) : units.read(read), (row) =>
      row === undefined || row.journal === null ? null : { journal: row.journal, evicted: row.evictedAt !== null },
    );
  };

  const formedRollout = Effect.fnUntraced(function* (threadId: string, tx?: Unit<'machine'>) {
    const read = (unit: Unit<'machine'>) => unit.run(rolloutById.get({ threadId }));
    const row = yield* tx === undefined ? units.read(read) : read(tx);
    if (row === undefined || row.journal === null || row.evictedAt === null || home === undefined) return null;
    if (!(yield* sources.retained(threadId)))
      return yield* new ThreadStorageFailed({
        call: 'rolloutReads.source',
        cause: new Error(`The source of ${threadId} was not retained before its read.`),
      });
    const canonical = `${home}/${row.journal}/${threadId}${ROLLOUT_SUFFIX}`;
    yield* forms.checked(threadId, canonical, tx).pipe(Effect.mapError(formFailed));
    if (row.source === null || row.source.form !== row.form || row.publishing !== null)
      return yield* new ThreadStorageFailed({
        call: 'rolloutReads.source',
        cause: new Error(`The rollout of ${threadId} needs source preparation.`),
      });
    lagging(threadId);
    return {
      ...sourceFiles(canonical, row.source),
      source: row.source,
      key: { bytes: row.source.bytes, position: row.source.position },
    };
  });

  const facts = async (
    path: string,
    through: number,
    window: ThreadRecordWindow,
    read: ReadRollout,
  ): Promise<readonly ThreadEventRow[]> => {
    const events: ThreadEventRow[] = [];
    if (window.limit <= 0) return events;
    for await (const { line } of wholeLinesAfter(
      path,
      await startAfter(decode, path, window.afterPosition, read, through),
      read,
      through,
    )) {
      const row = rowOf(decode, line);
      if (row === null || row.position <= window.afterPosition) continue;
      if (row.position > window.head) break;
      if (window.kinds !== undefined && !window.kinds.includes(row.kind)) continue;
      events.push(row);
      if (events.length >= window.limit) break;
    }
    return events;
  };

  const latestOf = async (
    threadId: string,
    path: string,
    standing: string,
    head: number,
    through: number,
    read: ReadRollout,
  ): Promise<readonly Latest[]> => {
    const held = indexed.get(threadId);
    if (held !== undefined && held.standing === standing && held.head === head) {
      held.touched = clock += 1;
      return held.latest;
    }
    const byIdentity = new Map<string, Latest>();
    let start = 0;
    for await (const { line, end } of wholeLinesAfter(path, 0, read, through)) {
      const at = start;
      start = end;
      const row = rowOf(decode, line);
      if (row === null) continue;
      if (row.position > head) break;
      if ((row.payload as { entry?: { id?: unknown } }).entry?.id == null) continue;
      const identity = eventIdentity(row.payload);
      if (identity === null) continue;
      byIdentity.set(identity, { identity, position: row.position, kind: row.kind, start: at });
    }
    const latest = [...byIdentity.values()].sort((one, next) => one.position - next.position);
    indexed.set(threadId, { standing, head, latest, touched: (clock += 1) });
    while (indexed.size > INDEXED_THREADS) {
      let oldest: string | null = null;
      let at = Number.POSITIVE_INFINITY;
      for (const [id, index] of indexed) {
        if (index.touched < at) {
          at = index.touched;
          oldest = id;
        }
      }
      if (oldest === null) break;
      indexed.delete(oldest);
    }
    return latest;
  };

  const revisionsIn = async (
    threadId: string,
    path: string,
    standing: string,
    through: number,
    window: ThreadRecordWindow,
    read: ReadRollout,
  ): Promise<readonly ThreadEventRevision[]> => {
    const answered: ThreadEventRevision[] = [];
    if (window.limit <= 0) return answered;
    for (const latest of await latestOf(threadId, path, standing, window.head, through, read)) {
      if (latest.position <= window.afterPosition) continue;
      if (window.kinds !== undefined && !window.kinds.includes(latest.kind)) continue;
      const row = await rowAt(decode, path, latest.start, read, through);
      if (row === null) continue;
      answered.push({ ...row, identity: latest.identity });
      if (answered.length >= window.limit) break;
    }
    return answered;
  };

  const reading = <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>) =>
    sources.using(threadId, Effect.andThen(sources.open(threadId), work));
  const ranging = <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>) =>
    sources.using(threadId, Effect.andThen(sources.prepare(threadId), work));
  const withSource = <A, E, R>(threadId: string, tx: Unit<'machine'> | undefined, work: Effect.Effect<A, E, R>) =>
    tx === undefined ? reading(threadId, work) : sources.retaining(threadId, work);

  return RestedRollouts.of({
    facet,
    restedRollout: formedRollout,
    readable: (threadId) => sources.using(threadId, sources.open(threadId)),
    reading,
    retaining: sources.retaining,
    ranging,
    events: (threadId, window, tx) =>
      withSource(
        threadId,
        tx,
        Effect.gen(function* () {
          const rollout = yield* formedRollout(threadId, tx);
          return rollout === null
            ? null
            : yield* lineRead('rolloutReads.events', (read) => facts(rollout.path, rollout.source.bytes, window, read));
        }),
      ),
    range: (threadId, window, tx) => {
      const work = Effect.gen(function* () {
        const standing = yield* facet(threadId, tx);
        if (standing === null || home === undefined) return null;
        const rollout = standing.evicted ? yield* formedRollout(threadId, tx) : null;
        if (standing.evicted && rollout === null)
          return yield* new ThreadStorageFailed({
            call: 'rolloutReads.range',
            cause: new Error(`The source of ${threadId} moved during its read.`),
          });
        const path = rollout?.path ?? `${home}/${standing.journal}/${threadId}${ROLLOUT_SUFFIX}`;
        const through = rollout?.source.bytes;
        if (!standing.evicted && (yield* rolloutStateOf(path)) !== null)
          yield* forms.checked(threadId, path, tx).pipe(Effect.mapError(formFailed));
        return yield* lineRead('rolloutReads.range', async (read) => {
          if ((await fileSize(path)) !== null)
            return rangeIn(
              decode,
              plainLines(path, await startAfter(decode, path, window.afterPosition, read, through), read, through),
              window,
            );
          if (rollout !== null) throw new Error(`${path} no longer holds its published prefix`);
          const chunks = await streamedRollout(path, read);
          return chunks === null ? null : rangeIn(decode, wholeLinesOf(chunks), window);
        });
      });
      return tx === undefined ? ranging(threadId, work) : sources.retaining(threadId, work);
    },
    revisions: (threadId, window, tx) =>
      withSource(
        threadId,
        tx,
        Effect.gen(function* () {
          const rollout = yield* formedRollout(threadId, tx);
          if (rollout === null) return null;
          const standing = `${rollout.source.generation}:${rollout.source.form ?? ''}:${rollout.source.fingerprint}`;
          return yield* lineRead('rolloutReads.revisions', (read) =>
            revisionsIn(threadId, rollout.path, standing, rollout.source.bytes, window, read),
          );
        }),
      ),
    position: (threadId, recordId, tx) =>
      withSource(
        threadId,
        tx,
        Effect.gen(function* () {
          const rollout = yield* formedRollout(threadId, tx);
          return rollout === null
            ? null
            : yield* lineRead('rolloutReads.position', (read) => positionIn(decode, rollout.path, recordId, read, rollout.source.bytes));
        }),
      ),
    head: (threadId, tx) => {
      const work = Effect.map(formedRollout(threadId, tx), (rollout) => rollout?.source.position ?? null);
      return tx === undefined ? ranging(threadId, work) : sources.retaining(threadId, work);
    },
    rested: (threadId, tx) => Effect.map(facet(threadId, tx), (standing) => standing !== null && standing.evicted),
  });
});

async function* plainLines(path: string, from: number, read: ReadRollout, through?: number): AsyncGenerator<string> {
  for await (const { line } of wholeLinesAfter(path, from, read, through)) yield line;
}

async function rangeIn(decode: PayloadDecode, lines: AsyncGenerator<string>, window: ThreadRecordWindow): Promise<RolloutRange> {
  const rows: ThreadEventRow[] = [];
  let through = window.afterPosition;
  try {
    for await (const line of lines) {
      if (rows.length >= window.limit) break;
      const row = rowOf(decode, line);
      if (row === null || row.position <= window.afterPosition) continue;
      if (row.position > window.head) break;
      if (row.position !== through + 1)
        throw new RolloutLineUnreadable(`the event at position ${row.position} follows position ${through}`);
      through = row.position;
      if (window.kinds === undefined || window.kinds.includes(row.kind)) rows.push(row);
    }
  } finally {
    await lines.return(undefined);
  }
  return { rows, through };
}

function rowOf(decode: PayloadDecode, line: string): ThreadEventRow | null {
  const event = eventOfLine(line);
  if (event === null) return null;
  const row = revived(event);
  const decoded = decode(threadOfEvent(event), row.payload);
  return { ...row, payload: Result.isSuccess(decoded) ? decoded.success : row.payload } as ThreadEventRow;
}

async function rowAt(
  decode: PayloadDecode,
  path: string,
  start: number,
  read: ReadRollout,
  through: number,
): Promise<ThreadEventRow | null> {
  for await (const { line } of wholeLinesAfter(path, start, read, through)) return rowOf(decode, line);
  return null;
}

async function startAfter(
  decode: PayloadDecode,
  path: string,
  afterPosition: number,
  read: ReadRollout,
  through?: number,
): Promise<number> {
  if (afterPosition <= 0) return 0;
  const size = through ?? (await fileSize(path)) ?? 0;
  const firstAt = async (offset: number): Promise<number> => {
    const start = await lineStartFrom(path, offset, read, through);
    for await (const { line } of wholeLinesAfter(path, start, read, through)) {
      const row = rowOf(decode, line);
      if (row !== null) return row.position;
    }
    return Number.POSITIVE_INFINITY;
  };
  let low = 0;
  let high = size;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((await firstAt(middle)) > afterPosition) high = middle;
    else low = middle + 1;
  }
  return lineStartFrom(path, low, read, through);
}

async function positionIn(
  decode: PayloadDecode,
  path: string,
  recordId: string,
  read: ReadRollout,
  through: number,
): Promise<number | null> {
  const needle = JSON.stringify(recordId.slice(recordId.lastIndexOf(':') + 1)).slice(1, -1);
  let named: number | null = null;
  if ((await stat(path)).size < through) throw new Error(`${path} ends before its published prefix`);
  for await (const { line } of wholeLinesBefore(path, through, read)) {
    if (!line.includes(needle)) continue;
    const row = rowOf(decode, line);
    if (row === null) continue;
    if (row.id === recordId) return row.position;
    if (named !== null) continue;
    const entryId = (row.payload as { entry?: { id?: unknown } }).entry?.id;
    if (entryId === recordId || eventIdentity(row.payload) === recordId) named = row.position;
  }
  return named;
}

export type PayloadDecode = (thread: string | null, value: unknown) => Result.Result<ThreadEventPayload, { readonly message: string }>;

const threadOfEvent = (event: RolloutEvent): string | null => (typeof event.threadId === 'string' ? event.threadId : null);

function eventOfLine(line: string) {
  if (line === '') return null;
  const read = readRolloutLine(line);
  if ('failure' in read) throw new RolloutLineUnreadable(`the line ${read.failure}`);
  if (read.record.kind !== 'event') return null;
  const event = rolloutEventOf(read.record);
  if (event === null) throw new RolloutLineUnreadable('an event line carries no position, id, kind and payload');
  return event;
}

export function transcriptFactOf(line: string, kinds: ThreadEntryReader) {
  const event = eventOfLine(line);
  return event === null
    ? null
    : { position: event.position, fact: transcriptFact(kinds, threadOfEvent(event), event.kind, event.id, revived(event).payload) };
}

export function factOf(
  line: string,
  decode: PayloadDecode,
): {
  readonly position: number;
  readonly kind: string;
  readonly payload: ThreadEventPayload;
  readonly row: Record<string, unknown>;
  readonly fact: ThreadEventFact;
} | null {
  const event = eventOfLine(line);
  if (event === null) return null;
  const row = revived(event);
  const decoded = decode(threadOfEvent(event), row.payload);
  if (Result.isFailure(decoded)) {
    throw new RolloutLineUnreadable(`the event at position ${event.position} cannot be read: ${decoded.failure.message}`);
  }
  const payload = decoded.success;
  const kind = event.kind;
  return { position: event.position, kind, payload, row: { ...row, payload }, fact: threadEventFact({ kind, payload }) };
}

export class RolloutLineUnreadable extends Data.TaggedError('RolloutLineUnreadable')<{ readonly message: string }> {
  constructor(message = '', options?: ErrorOptions) {
    super({ message });
    this.name = 'Error';
    if (options !== undefined && 'cause' in options)
      Object.defineProperty(this, 'cause', { value: options.cause, writable: true, configurable: true });
  }
}

const formFailed = (cause: unknown): ThreadStorageFailed =>
  cause instanceof ThreadStorageFailed ? cause : new ThreadStorageFailed({ call: 'rolloutReads.form', cause });

export function lineRead<A>(call: string, read: (observe: ReadRollout) => Promise<A>): Effect.Effect<A, ThreadStorageFailed> {
  return Effect.flatMap(RolloutReads, (observe) =>
    Effect.tryPromise({ try: () => read(observe), catch: (cause) => new ThreadStorageFailed({ call, cause }) }),
  );
}
