import { Data, Effect, FileSystem, Path, Schema, Semaphore } from 'effect';
import {
  JOURNAL_FILE,
  SEAL_FILE,
  journalCodec,
  streamsOf,
  type JournalEntry,
  type JournalDelta,
  type JournalSnapshot,
  type SealedSegment,
} from '@runlith/executions/recordFormat';
import type { ExecutionRef, StreamEnding, Transport } from '@runlith/executions/protocol/execution';
import {
  byteOffset,
  offsetValue,
  type ByteOffset,
  type GridEntry,
  type Stream,
  type TerminalGeometry,
} from '@runlith/executions/protocol/record';

export class JournalInvalid extends Data.TaggedError('JournalInvalid')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const decode = Schema.decodeUnknownEffect(journalCodec);
const encode = Schema.encodeEffect(journalCodec);
type HeldStream = {
  readonly streaming: true | undefined;
  retainedFrom: ByteOffset;
  through: ByteOffset;
  ending: StreamEnding;
  readonly segments: Map<ByteOffset, SealedSegment>;
  grid: GridEntry[];
  gridFrom: number;
};

type RetainedFrontier = { readonly stream: Stream; readonly from: ByteOffset };
type JournalPlan = { readonly delta: number; readonly apply: () => void };

type Opening = {
  readonly directory: string;
  readonly ref: ExecutionRef;
  readonly transport: Transport;
} & (
  | { readonly mode: 'create'; readonly grid?: TerminalGeometry; readonly streaming?: ReadonlyArray<Stream> }
  | { readonly mode: 'reopen' }
);

export const makeRecordJournal = Effect.fnUntraced(function* (opening: Opening) {
  const { directory, ref, transport } = opening;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gate = yield* Semaphore.make(1);
  let entries = 1;
  let live = 0;
  const heldStreams = new Map<Stream, HeldStream>();

  function seed(state: JournalSnapshot): void {
    live = 1 + state.streams.length;
    for (const stream of state.streams) {
      heldStreams.set(stream.stream, {
        streaming: stream.streaming,
        retainedFrom: stream.retainedFrom,
        through: stream.segments.at(-1)?.end ?? stream.retainedFrom,
        ending: stream.ending,
        segments: new Map(stream.segments.map((segment) => [segment.first, segment])),
        grid: [...stream.grid],
        gridFrom: 0,
      });
      live += stream.segments.length + stream.grid.length;
    }
  }

  function retained(): ReadonlyArray<RetainedFrontier> {
    return [...heldStreams].map(([stream, held]) => ({ stream, from: held.retainedFrom }));
  }

  function snapshot(): JournalSnapshot {
    return {
      ref,
      transport,
      streams: [...heldStreams].map(([stream, held]) => ({
        stream,
        streaming: held.streaming,
        retainedFrom: held.retainedFrom,
        ending: held.ending,
        segments: [...held.segments.values()],
        grid: held.grid.slice(held.gridFrom),
      })),
    };
  }

  const append = Effect.fnUntraced(function* (entry: JournalDelta) {
    const plan = yield* prepare(entry);
    yield* write(entry, 'a');
    plan.apply();
    live += plan.delta;
    entries++;
    if (entries <= live * 2) return;
    const draft = path.join(directory, `${JOURNAL_FILE}.next`);
    yield* write({ _tag: 'Snapshot', state: snapshot() }, 'w', draft);
    yield* fs.rename(draft, path.join(directory, JOURNAL_FILE));
    for (const held of heldStreams.values()) {
      held.grid = held.grid.slice(held.gridFrom);
      held.gridFrom = 0;
    }
    entries = 1;
  }, gate.withPermits(1));

  const prepare = Effect.fnUntraced(function* (entry: JournalDelta): Effect.fn.Return<JournalPlan, JournalInvalid> {
    const stream = entry._tag === 'Grid' ? 'pty' : entry.stream;
    const held = heldStreams.get(stream);
    if (held === undefined) return yield* new JournalInvalid({ detail: `the journal carries no ${stream}` });
    if (entry._tag === 'Closed') {
      if (held.ending !== 'open' || entry.segment.first !== held.through || offsetValue(entry.segment.end) < offsetValue(held.through)) {
        return yield* new JournalInvalid({ detail: `${stream} closes outside its frontier ${held.through}` });
      }
      return {
        delta: 1,
        apply: () => {
          held.segments.set(entry.segment.first, entry.segment);
          held.through = entry.segment.end;
          held.ending = entry.ending ?? 'open';
        },
      };
    }
    if (entry._tag === 'Retained') {
      const from = offsetValue(entry.from);
      const dropped: ByteOffset[] = [];
      let reached = held.retainedFrom;
      for (const segment of held.segments.values()) {
        if (offsetValue(segment.end) > from) break;
        dropped.push(segment.first);
        reached = segment.end;
      }
      if (from < offsetValue(held.retainedFrom) || dropped.length === 0 || reached !== entry.from) {
        return yield* new JournalInvalid({ detail: `${stream} retains from ${from} outside closed segments` });
      }
      let standing = held.gridFrom;
      while (held.grid[standing + 1] !== undefined && offsetValue(held.grid[standing + 1]!.at) <= from) standing++;
      return {
        delta: -dropped.length - (standing - held.gridFrom),
        apply: () => {
          for (const first of dropped) held.segments.delete(first);
          held.retainedFrom = entry.from;
          held.gridFrom = standing;
        },
      };
    }
    let kept = held.grid.length;
    while (kept > held.gridFrom && offsetValue(held.grid[kept - 1]!.at) >= offsetValue(entry.from)) kept--;
    if ((kept === held.gridFrom && entry.entry === undefined) || (entry.entry !== undefined && entry.entry.at !== entry.from)) {
      return yield* new JournalInvalid({ detail: 'the grid entry does not preserve the standing track' });
    }
    return {
      delta: kept - held.grid.length + (entry.entry === undefined ? 0 : 1),
      apply: () => {
        held.grid.length = kept;
        if (entry.entry !== undefined) held.grid.push(entry.entry);
      },
    };
  });

  const write = Effect.fnUntraced(function* (entry: JournalEntry, flag: 'a' | 'w' | 'wx', file = path.join(directory, JOURNAL_FILE)) {
    const text = yield* encode(entry);
    const handle = yield* fs.open(file, { flag, mode: 0o600 });
    yield* handle.writeAll(new TextEncoder().encode(`${text}\n`));
  }, Effect.scoped);

  if (opening.mode === 'create') {
    const state: JournalSnapshot = {
      ref,
      transport,
      streams: streamsOf(transport).map((stream) => ({
        stream,
        streaming: opening.streaming?.includes(stream) === true ? true : undefined,
        retainedFrom: byteOffset(0n),
        segments: [],
        ending: 'open',
        grid: stream === 'pty' && opening.grid !== undefined ? [{ at: byteOffset(0n), geometry: opening.grid }] : [],
      })),
    };
    seed(state);
    yield* write({ _tag: 'Snapshot', state }, 'wx');
  } else {
    if (yield* fs.exists(path.join(directory, SEAL_FILE))) return yield* new JournalInvalid({ detail: 'the record is already sealed' });
    const file = path.join(directory, JOURNAL_FILE);
    const bytes = yield* fs.readFile(file);
    const complete = bytes.lastIndexOf(10) + 1;
    if (complete === 0) return yield* new JournalInvalid({ detail: 'the journal has no complete opening entry' });
    const text = yield* Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, complete)),
      catch: (error) => new JournalInvalid({ detail: `the journal is not UTF-8: ${String(error)}` }),
    });
    const lines = text.split('\n');
    let hasOpening = false;
    let count = 0;
    for (const line of lines.slice(0, -1)) {
      const entry = yield* decode(line);
      if (!hasOpening) {
        if (entry._tag !== 'Snapshot') return yield* new JournalInvalid({ detail: 'the journal does not begin with its state' });
        const state = entry.state;
        if (
          state.ref.installation !== ref.installation ||
          state.ref.incarnation !== ref.incarnation ||
          state.ref.execution !== ref.execution
        ) {
          return yield* new JournalInvalid({ detail: 'the journal names another execution' });
        }
        if (state.transport !== transport) return yield* new JournalInvalid({ detail: 'the journal names another transport' });
        const defect = incoherent(state);
        if (defect !== undefined) return yield* new JournalInvalid({ detail: defect });
        seed(state);
        hasOpening = true;
      } else {
        if (entry._tag === 'Snapshot') return yield* new JournalInvalid({ detail: 'a state entry occurs inside the journal' });
        const plan = yield* prepare(entry);
        plan.apply();
        live += plan.delta;
      }
      count++;
    }
    if (!hasOpening) return yield* new JournalInvalid({ detail: 'the journal has no opening state' });
    if (complete !== bytes.length) yield* fs.truncate(file, complete);
    entries = count;
  }

  return {
    directory,
    get retained() {
      return retained();
    },
    get snapshot() {
      return snapshot();
    },
    append,
  };
});

export type RecordJournal = Effect.Success<ReturnType<typeof makeRecordJournal>>;

const incoherent = (state: JournalSnapshot): string | undefined => {
  const streams = streamsOf(state.transport);
  if (state.streams.length !== streams.length || new Set(state.streams.map((stream) => stream.stream)).size !== streams.length) {
    return 'the opening state does not name each transport stream once';
  }
  for (const held of state.streams) {
    if (!streams.includes(held.stream)) return `the opening state names foreign stream ${held.stream}`;
    let at = held.retainedFrom;
    for (const segment of held.segments) {
      if (segment.first !== at || offsetValue(segment.end) < offsetValue(at)) return `${held.stream} has discontinuous closed segments`;
      at = segment.end;
    }
    if (held.stream === 'pty') {
      if (held.grid[0] === undefined || offsetValue(held.grid[0].at) > offsetValue(held.retainedFrom)) return 'no grid stands at retention';
    } else if (held.grid.length !== 0) return `${held.stream} carries a grid`;
    let previous = -1n;
    for (const entry of held.grid) {
      if (offsetValue(entry.at) <= previous) return 'grid positions do not increase';
      previous = offsetValue(entry.at);
    }
  }
  return undefined;
};
