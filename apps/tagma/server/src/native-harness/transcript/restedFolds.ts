import { type FileHandle, open } from 'node:fs/promises';
import { Deferred, Effect, Result } from 'effect';
import type { ThreadHistory } from '@runlith/agent/thread/rows';
import type { ThreadTranscript, ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import type { ThreadTranscriptQuery } from '@runlith/agent/thread/storage/aggregate';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { StoredFailure } from '../../platform/store/crossing.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { wholeLinesAfter } from '../../threads/journal/rolloutFile.js';
import { lineRead } from '../../threads/journal/restedReads.js';
import { type RestedRollout, RestedRollouts, type TranscriptKey } from '../../threads/contract/service/rested.js';
import type { Placed, Weighed } from './rows.js';
import { takeTranscriptPage } from './rows.js';
import { entryOf, ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import {
  TRANSCRIPT_FOOTER_BYTES,
  TRANSCRIPT_FORM,
  TRANSCRIPT_OPEN_BYTES,
  TRANSCRIPT_SLOT_BYTES,
  type RestedCompaction,
  RestedWork,
} from './restedWork.js';
import type { ReadRollout } from '../../threads/contract/service/rolloutReads.js';

export type RestedTranscript = { readonly path: string; readonly entries: number; readonly bodies: number; readonly open: number };

const FOLD_CEILING_BYTES = 128 * 1024 * 1024;

type Held = { readonly bytes: number; readonly key: TranscriptKey; touched: number } & (
  | { readonly kind: 'history'; readonly history: ThreadHistory }
  | { readonly kind: 'compaction'; readonly summary: RestedCompaction }
);

export type RestedFolds = Effect.Success<typeof makeRestedFolds>;

export const makeRestedFolds = Effect.gen(function* () {
  const reads = yield* RestedRollouts;
  const kinds = yield* ThreadEntryKinds;
  const work = yield* RestedWork;
  const held = new Map<string, Held>();
  const building = new Map<string, Deferred.Deferred<void, StoredFailure>>();
  const compactions = new Map<string, Deferred.Deferred<RestedCompaction, StoredFailure>>();
  let total = 0;
  let clock = 0;

  const built = (rollout: RestedRollout): Effect.Effect<void, StoredFailure> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const key = `${rollout.transcript}:${rollout.key.bytes}:${rollout.key.position}`;
        const standing = building.get(key);
        if (standing !== undefined) return yield* Deferred.await(standing);
        const done = yield* Deferred.make<void, StoredFailure>();
        building.set(key, done);
        const exit = yield* Effect.exit(
          work.transcribe(kinds, rollout, rollout.key).pipe(
            Effect.asVoid,
            Effect.mapError((cause) => new ThreadStorageFailed({ call: 'restedTranscript.build', cause })),
          ),
        );
        building.delete(key);
        yield* Deferred.done(done, exit);
        return yield* exit;
      }),
    );

  const keep = (slot: string, entry: Held): void => {
    const gone = held.get(slot);
    if (gone !== undefined) {
      held.delete(slot);
      total -= gone.bytes;
    }
    if (entry.bytes > FOLD_CEILING_BYTES) return;
    held.set(slot, entry);
    total += entry.bytes;
    while (total > FOLD_CEILING_BYTES) {
      let oldest: string | null = null;
      let at = Number.POSITIVE_INFINITY;
      for (const [id, one] of held) {
        if (id !== slot && one.touched < at) {
          at = one.touched;
          oldest = id;
        }
      }
      if (oldest === null) break;
      const evicted = held.get(oldest);
      if (evicted === undefined) break;
      held.delete(oldest);
      total -= evicted.bytes;
    }
  };

  return {
    head: reads.head,
    compaction: Effect.fn('ThreadTranscript.rested.compaction')(function* (threadId: string) {
      const rollout = yield* reads.restedRollout(threadId);
      if (rollout === null) return null;
      const slot = `compaction:${threadId}`;
      const cached = held.get(slot);
      if (cached?.kind === 'compaction' && sameKey(cached.key, rollout.key)) {
        cached.touched = clock += 1;
        return cached.summary;
      }
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const key = `${rollout.path}:${rollout.key.bytes}:${rollout.key.position}`;
          const standing = compactions.get(key);
          if (standing !== undefined) return yield* Deferred.await(standing);
          const done = yield* Deferred.make<RestedCompaction, StoredFailure>();
          compactions.set(key, done);
          const exit = yield* Effect.exit(
            work
              .compaction(kinds, rollout)
              .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'restedCompaction.read', cause }))),
          );
          compactions.delete(key);
          yield* Deferred.done(done, exit);
          const summary = yield* exit;
          keep(slot, { kind: 'compaction', summary, bytes: summary.bytes, key: rollout.key, touched: (clock += 1) });
          return summary;
        }),
      );
    }),
    transcript: Effect.fnUntraced(function* (threadId: string, tx?: Unit<'machine'>) {
      const rollout = yield* reads.restedRollout(threadId, tx);
      if (rollout === null) return null;
      const path = rollout.transcript;
      const standing = yield* lineRead('restedTranscript.open', (observe) => footerOf(path, rollout.key, observe));
      if (standing !== null) return standing;
      yield* built(rollout);
      const rebuilt = yield* lineRead('restedTranscript.open', (observe) => footerOf(path, rollout.key, observe));
      if (rebuilt !== null) return rebuilt;
      return yield* new ThreadStorageFailed({
        call: 'restedTranscript.open',
        cause: new Error(`${path} does not answer the rollout it was built from`),
      });
    }),
    window: Effect.fn('ThreadTranscript.rested.window')(function* (transcript: RestedTranscript, query: ThreadTranscriptQuery) {
      const roof = query.before === undefined ? transcript.entries : Math.max(0, Math.min(transcript.entries, Math.ceil(query.before)));
      const floor = Math.max(0, roof - query.limit);
      const slots = yield* lineRead('restedTranscript.window', (observe) => slotsOf(transcript, floor, roof, observe));
      const candidates: Weighed[] = [];
      for (let ord = roof - 1; ord >= floor; ord -= 1) candidates.push({ ord, weight: slots.weight(ord) });
      let bytes = TRANSCRIPT_FOOTER_BYTES + (roof - floor + 1) * TRANSCRIPT_SLOT_BYTES;
      const page = yield* takeTranscriptPage(
        candidates,
        query,
        (taken) =>
          lineRead('restedTranscript.window', async (observe) => {
            const first = taken[0]?.ord ?? roof;
            const last = taken[taken.length - 1]?.ord ?? roof - 1;
            const start = slots.offset(first);
            const end = slots.offset(last + 1);
            bytes += end - start;
            return bodiesOf(kinds, await rangeOf(transcript.path, start, end - start, observe), first);
          }),
        (oldest) => Effect.succeed(oldest > 0),
      );
      yield* Effect.annotateCurrentSpan({ bytes, entries: page.entries.length });
      return page;
    }),
    entries: (transcript: RestedTranscript): Effect.Effect<ThreadTranscript, StoredFailure> =>
      lineRead('restedTranscript.entries', (observe) => scanned(kinds, transcript, '', () => true, false, observe)),
    ofRun: (transcript: RestedTranscript, runId: string): Effect.Effect<ThreadTranscript, StoredFailure> =>
      lineRead('restedTranscript.ofRun', (observe) =>
        scanned(kinds, transcript, JSON.stringify(runId), (entry) => entry.runId === runId, false, observe),
      ),
    openQuestionsOfRun: (transcript: RestedTranscript, runId: string): Effect.Effect<readonly ThreadQuestionEntry[], StoredFailure> =>
      lineRead('restedTranscript.openQuestionsOfRun', async (observe) =>
        (await openOf(kinds, transcript, observe)).filter((entry) => entry.runId === runId),
      ),
    questionById: (transcript: RestedTranscript, questionId: string): Effect.Effect<ThreadTranscript, StoredFailure> =>
      lineRead('restedTranscript.questionById', (observe) =>
        scanned(
          kinds,
          transcript,
          JSON.stringify(questionId),
          (entry) => entryOf('question')(entry) && entry.questionId === questionId,
          false,
          observe,
        ),
      ),
    byId: (transcript: RestedTranscript, entryId: string): Effect.Effect<ThreadTranscriptEntry | undefined, StoredFailure> =>
      lineRead(
        'restedTranscript.byId',
        async (observe) => (await scanned(kinds, transcript, JSON.stringify(entryId), (entry) => entry.id === entryId, true, observe))[0],
      ),
    history: Effect.fnUntraced(function* (threadId: string, tx?: Unit<'machine'>) {
      const rollout = yield* reads.restedRollout(threadId, tx);
      if (rollout === null) return null;
      const slot = `history:${threadId}`;
      const cached = held.get(slot);
      if (cached?.kind === 'history' && sameKey(cached.key, rollout.key)) {
        cached.touched = clock += 1;
        return cached.history;
      }
      const folded = yield* work
        .history(kinds, rollout)
        .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'rolloutReads.history', cause })));
      keep(slot, { kind: 'history', history: folded.history, bytes: folded.bytes, key: rollout.key, touched: (clock += 1) });
      return folded.history;
    }),
  };
});

const sameKey = (one: TranscriptKey, other: TranscriptKey): boolean => one.bytes === other.bytes && one.position === other.position;

async function readAt(handle: FileHandle, path: string, start: number, length: number, observe: ReadRollout): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled);
    observe({ path, bytes: bytesRead });
    if (bytesRead === 0) throw new Error(`${path} ends before byte ${start + length}`);
    filled += bytesRead;
  }
  return buffer;
}

async function rangeOf(path: string, start: number, length: number, observe: ReadRollout): Promise<Buffer> {
  if (length === 0) return Buffer.alloc(0);
  const handle = await open(path, 'r');
  try {
    return await readAt(handle, path, start, length, observe);
  } finally {
    await handle.close();
  }
}

async function footerOf(path: string, key: TranscriptKey, observe: ReadRollout): Promise<RestedTranscript | null> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
  try {
    const size = (await handle.stat()).size;
    if (size < TRANSCRIPT_FOOTER_BYTES) return null;
    const footer = Buffer.alloc(TRANSCRIPT_FOOTER_BYTES);
    const read = await handle.read(footer, 0, TRANSCRIPT_FOOTER_BYTES, size - TRANSCRIPT_FOOTER_BYTES);
    observe({ path, bytes: read.bytesRead });
    const entries = footer.readDoubleLE(0);
    const bodies = footer.readDoubleLE(8);
    const open = footer.readDoubleLE(16);
    if (footer.readDoubleLE(40) !== TRANSCRIPT_FORM) return null;
    if (!sameKey({ bytes: footer.readDoubleLE(24), position: footer.readDoubleLE(32) }, key)) return null;
    if (bodies + entries * TRANSCRIPT_SLOT_BYTES + open * TRANSCRIPT_OPEN_BYTES + TRANSCRIPT_FOOTER_BYTES !== size) return null;
    return { path, entries, bodies, open };
  } finally {
    await handle.close();
  }
}

type Slots = { readonly offset: (ord: number) => number; readonly weight: (ord: number) => number };

async function slotsOf(transcript: RestedTranscript, floor: number, roof: number, observe: ReadRollout): Promise<Slots> {
  const through = Math.min(roof + 1, transcript.entries);
  const read = await rangeOf(
    transcript.path,
    transcript.bodies + floor * TRANSCRIPT_SLOT_BYTES,
    (through - floor) * TRANSCRIPT_SLOT_BYTES,
    observe,
  );
  const at = (ord: number): number => (ord - floor) * TRANSCRIPT_SLOT_BYTES;
  return {
    offset: (ord) => (ord >= transcript.entries ? transcript.bodies : read.readDoubleLE(at(ord))),
    weight: (ord) => read.readDoubleLE(at(ord) + 8),
  };
}

function fileEntry(kinds: ThreadEntryReader, line: string): ThreadTranscriptEntry {
  const read = kinds.decode(JSON.parse(line));
  if (Result.isFailure(read)) throw read.failure;
  return read.success;
}

function bodiesOf(kinds: ThreadEntryReader, bytes: Buffer, first: number): Placed[] {
  const placed: Placed[] = [];
  let from = 0;
  for (let newline = bytes.indexOf(0x0a); newline !== -1; newline = bytes.indexOf(0x0a, from)) {
    placed.push({ ord: first + placed.length, entry: fileEntry(kinds, bytes.toString('utf8', from, newline)) });
    from = newline + 1;
  }
  return placed;
}

async function openOf(kinds: ThreadEntryReader, transcript: RestedTranscript, observe: ReadRollout): Promise<ThreadQuestionEntry[]> {
  if (transcript.open === 0) return [];
  const handle = await open(transcript.path, 'r');
  try {
    const table = await readAt(
      handle,
      transcript.path,
      transcript.bodies + transcript.entries * TRANSCRIPT_SLOT_BYTES,
      transcript.open * TRANSCRIPT_OPEN_BYTES,
      observe,
    );
    const found: ThreadQuestionEntry[] = [];
    for (let at = 0; at < table.length; at += TRANSCRIPT_OPEN_BYTES) {
      const start = table.readDoubleLE(at + 8);
      const body = await readAt(handle, transcript.path, start, table.readDoubleLE(at + 16) - start - 1, observe);
      const entry = fileEntry(kinds, body.toString('utf8'));
      if (entryOf('question')(entry)) found.push(entry);
    }
    return found;
  } finally {
    await handle.close();
  }
}

async function scanned(
  kinds: ThreadEntryReader,
  transcript: RestedTranscript,
  needle: string,
  wanted: (entry: ThreadTranscriptEntry) => boolean,
  one: boolean,
  observe: ReadRollout,
): Promise<ThreadTranscriptEntry[]> {
  const found: ThreadTranscriptEntry[] = [];
  for await (const { line, end } of wholeLinesAfter(transcript.path, 0, observe)) {
    if (end > transcript.bodies) break;
    if (!line.includes(needle)) continue;
    const entry = fileEntry(kinds, line);
    if (!wanted(entry)) continue;
    found.push(entry);
    if (one) break;
  }
  return found;
}
