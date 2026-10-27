import { stat } from 'node:fs/promises';
import { Data, Effect, Result } from 'effect';
import { eq, sql } from 'drizzle-orm';
import type { ThreadEventPayload } from '@runlith/agent/thread/events';
import { threadEventFact } from '@runlith/agent/thread/ThreadEventDoor';
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
  rolloutEventOf,
  wholeLinesAfter,
  wholeLinesBefore,
  wholeLinesOf,
} from './rolloutFile.js';
import { ROLLOUT_SUFFIX, rolloutFiles, rolloutStateOf, streamedRollout } from './rolloutForms.js';
import { revived } from './rolloutMeta.js';
import type { RolloutForms } from './rolloutForming.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { journalProjectOf, threadRolloutCursor } from '../store/journal.js';
import { RestedRollouts, type RolloutRange } from '../contract/service/rested.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';

const ROLLOUT_HEAD_LINES = 8;

type Latest = { readonly identity: string; readonly position: number; readonly kind: string; readonly start: number };

type Indexed = { readonly standing: string; readonly head: number; readonly latest: readonly Latest[]; touched: number };

//! A walk pages one pinned head, so the latest revisions are found once per walk rather than once per page; a handful of walks run at once.
const INDEXED_THREADS = 8;

export const makeRestedReads = Effect.fnUntraced(function* ({
  forms,
  home,
  lagging,
}: {
  readonly forms: RolloutForms;
  readonly home: string | undefined;
  readonly lagging: (threadId: string) => void;
}) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const decode: PayloadDecode = (value) => decodeThreadEventPayloadResult(kinds, value);
  const indexed = new Map<string, Indexed>();
  let clock = 0;

  const facet = (threadId: string, tx?: Unit<'machine'>) => {
    const read = (unit: Unit<'machine'>) =>
      unit.run(
        db
          .select({
            journal: journalProjectOf(recordFacts.id, recordFacts.projectId),
            evictedAt: restedAtOf(recordFacts.id),
          })
          .from(recordFacts)
          .where(eq(recordFacts.id, threadId))
          .get(),
      );
    return Effect.map(tx ? read(tx) : units.read(read), (row) =>
      row === undefined || row.journal === null ? null : { journal: row.journal, evicted: row.evictedAt !== null },
    );
  };

  const formedPath = Effect.fnUntraced(function* (threadId: string, tx?: Unit<'machine'>) {
    const standing = yield* facet(threadId, tx);
    if (standing === null || !standing.evicted || home === undefined) return null;
    const path = `${home}/${standing.journal}/${threadId}${ROLLOUT_SUFFIX}`;
    if ((yield* rolloutStateOf(path)) === null) return null;
    yield* forms.readable(threadId, path).pipe(Effect.mapError(formFailed));
    lagging(threadId);
    return path;
  });

  const keyedRollout = (threadId: string, tx?: Unit<'machine'>) => {
    const read = (unit: Unit<'machine'>) =>
      unit.run(
        db
          .select({
            journal: journalProjectOf(recordFacts.id, recordFacts.projectId),
            evictedAt: restedAtOf(recordFacts.id),
            bytes: threadRolloutCursor.nextByteOffset,
            position: threadRolloutCursor.nextPosition,
          })
          .from(recordFacts)
          .leftJoin(threadRolloutCursor, eq(threadRolloutCursor.threadId, recordFacts.id))
          .where(eq(recordFacts.id, threadId))
          .get(),
      );
    return Effect.map(tx ? read(tx) : units.read(read), (row) =>
      row === undefined || row.journal === null || row.evictedAt === null || home === undefined
        ? null
        : {
            ...rolloutFiles(`${home}/${row.journal}/${threadId}${ROLLOUT_SUFFIX}`),
            key: { bytes: row.bytes ?? 0, position: row.position ?? 0 },
          },
    );
  };

  const facts = async (path: string, window: ThreadRecordWindow, read: ReadRollout): Promise<readonly ThreadEventRow[]> => {
    const events: ThreadEventRow[] = [];
    if (window.limit <= 0) return events;
    for await (const { line } of wholeLinesAfter(path, await startAfter(decode, path, window.afterPosition, read), read)) {
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
    read: ReadRollout,
  ): Promise<readonly Latest[]> => {
    const held = indexed.get(threadId);
    if (held !== undefined && held.standing === standing && held.head === head) {
      held.touched = clock += 1;
      return held.latest;
    }
    const byIdentity = new Map<string, Latest>();
    let start = 0;
    for await (const { line, end } of wholeLinesAfter(path, 0, read)) {
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
    window: ThreadRecordWindow,
    read: ReadRollout,
  ): Promise<readonly ThreadEventRevision[]> => {
    const answered: ThreadEventRevision[] = [];
    if (window.limit <= 0) return answered;
    for (const latest of await latestOf(threadId, path, standing, window.head, read)) {
      if (latest.position <= window.afterPosition) continue;
      if (window.kinds !== undefined && !window.kinds.includes(latest.kind)) continue;
      const row = await rowAt(decode, path, latest.start, read);
      if (row === null) continue;
      answered.push({ ...row, identity: latest.identity });
      if (answered.length >= window.limit) break;
    }
    return answered;
  };

  const lastPosition = (path: string) =>
    lineRead('rolloutReads.head', async (read) => {
      let seen = 0;
      for await (const { line } of wholeLinesBefore(path, (await stat(path)).size, read)) {
        const fact = factOf(line, decode);
        if (fact === null) continue;
        const position = fact.row.position;
        if (typeof position === 'number') return position;
        seen += 1;
        if (seen >= ROLLOUT_HEAD_LINES) return null;
      }
      return null;
    });

  return RestedRollouts.of({
    facet,
    restedRollout: (threadId, tx) => Effect.andThen(formedPath(threadId, tx), keyedRollout(threadId, tx)),
    readable: (threadId) => Effect.asVoid(formedPath(threadId)),
    events: Effect.fnUntraced(function* (threadId, window, tx) {
      const path = yield* formedPath(threadId, tx);
      return path === null ? null : yield* lineRead('rolloutReads.events', (read) => facts(path, window, read));
    }),
    range: Effect.fnUntraced(function* (threadId, window, tx) {
      const standing = yield* facet(threadId, tx);
      if (standing === null || home === undefined) return null;
      const path = `${home}/${standing.journal}/${threadId}${ROLLOUT_SUFFIX}`;
      if ((yield* rolloutStateOf(path)) !== null) {
        yield* forms.formed(threadId, path).pipe(Effect.mapError(formFailed));
        if (standing.evicted) lagging(threadId);
      }
      return yield* lineRead('rolloutReads.range', async (read) => {
        if ((await fileSize(path)) !== null)
          return rangeIn(decode, plainLines(path, await startAfter(decode, path, window.afterPosition, read), read), window);
        const chunks = await streamedRollout(path, read);
        return chunks === null ? null : rangeIn(decode, wholeLinesOf(chunks), window);
      });
    }),
    revisions: Effect.fnUntraced(function* (threadId, window, tx) {
      const path = yield* formedPath(threadId, tx);
      if (path === null) return null;
      const standing = yield* Effect.promise(() => standingOf(path));
      if (standing === null) return null;
      return yield* lineRead('rolloutReads.revisions', (read) => revisionsIn(threadId, path, standing, window, read));
    }),
    position: Effect.fnUntraced(function* (threadId, recordId, tx) {
      const path = yield* formedPath(threadId, tx);
      return path === null ? null : yield* lineRead('rolloutReads.position', (read) => positionIn(decode, path, recordId, read));
    }),
    head: Effect.fnUntraced(function* (threadId, tx) {
      const path = yield* formedPath(threadId, tx);
      return path === null ? null : yield* lastPosition(path);
    }),
    rested: (threadId, tx) => Effect.map(facet(threadId, tx), (standing) => standing !== null && standing.evicted),
  });
});

async function* plainLines(path: string, from: number, read: ReadRollout): AsyncGenerator<string> {
  for await (const { line } of wholeLinesAfter(path, from, read)) yield line;
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
  const fact = factOf(line, decode);
  if (fact === null || typeof fact.row.position !== 'number') return null;
  return { ...fact.row, payload: fact.payload } as ThreadEventRow;
}

async function standingOf(path: string): Promise<string | null> {
  try {
    const standing = await stat(path);
    return `${standing.size}:${standing.mtimeMs}`;
  } catch {
    return null;
  }
}

async function rowAt(decode: PayloadDecode, path: string, start: number, read: ReadRollout): Promise<ThreadEventRow | null> {
  for await (const { line } of wholeLinesAfter(path, start, read)) return rowOf(decode, line);
  return null;
}

async function startAfter(decode: PayloadDecode, path: string, afterPosition: number, read: ReadRollout): Promise<number> {
  if (afterPosition <= 0) return 0;
  const size = (await fileSize(path)) ?? 0;
  const firstAt = async (offset: number): Promise<number> => {
    const start = await lineStartFrom(path, offset, read);
    for await (const { line } of wholeLinesAfter(path, start, read)) {
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
  return lineStartFrom(path, low, read);
}

async function positionIn(decode: PayloadDecode, path: string, recordId: string, read: ReadRollout): Promise<number | null> {
  const needle = JSON.stringify(recordId.slice(recordId.lastIndexOf(':') + 1)).slice(1, -1);
  let named: number | null = null;
  for await (const { line } of wholeLinesBefore(path, (await stat(path)).size, read)) {
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

export type PayloadDecode = (value: unknown) => Result.Result<ThreadEventPayload, { readonly message: string }>;

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
  if (line === '') return null;
  const read = readRolloutLine(line);
  if ('failure' in read) throw new RolloutLineUnreadable(`the line ${read.failure}`);
  if (read.record.kind !== 'event') return null;
  const event = rolloutEventOf(read.record);
  if (event === null) throw new RolloutLineUnreadable('an event line carries no position, id, kind and payload');
  const row = revived(event);
  const decoded = decode(row.payload);
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
