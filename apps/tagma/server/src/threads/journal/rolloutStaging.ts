import { createHash, type Hash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { once } from 'node:events';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress } from 'node:zlib';
import { Data } from 'effect';
import { reversed, ThreadFormRefused, type ThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import type { ReadRollout } from '../contract/service/rolloutReads.js';
import type { RolloutFiles } from '../contract/service/rested.js';
import { rolloutStream } from './rolloutFile.js';
import { isMetaRecord } from './rolloutMeta.js';

export type RolloutStage = {
  readonly form: 'plain' | 'compressed';
  readonly wanted: readonly number[];
  readonly steps: readonly string[];
  readonly back: boolean;
  readonly suffix: string;
};

export type StagedFile =
  | {
      readonly kind: 'staged';
      readonly changed: boolean;
      readonly moved: readonly (readonly [number, number])[];
      readonly sha256: string;
      readonly staged: string;
      readonly published: string;
    }
  | { readonly kind: 'unformable'; readonly reason: string };

type Formed = {
  readonly changed: boolean;
  readonly moved: ReadonlyMap<number, number>;
  readonly sha256: string;
};

class LineUnformable extends Data.TaggedError('LineUnformable')<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

type Line = { readonly current: string | null };

const KEPT: Line = { current: null };

type RecordForm = {
  readonly events: boolean;
  readonly form: (kind: 'event' | 'meta', held: unknown) => { readonly value: unknown; readonly changed: boolean };
};

export const eventless = (steps: readonly ThreadFormStep[]): boolean =>
  steps.every((step) => step.payload === undefined && step.entry === undefined && step.message === undefined);

const recordForm = (kinds: ThreadEntryReader, steps: readonly ThreadFormStep[]): RecordForm => ({
  events: !eventless(steps),
  form: (kind, held) => {
    const value = kind === 'meta' ? kinds.formed('meta', held, steps) : kinds.formedEvent(held, steps);
    return { value, changed: value !== held };
  },
});

const named = (kinds: ThreadEntryReader, names: readonly string[], back: boolean): readonly ThreadFormStep[] => {
  const held = new Map(kinds.after(null).map((step) => [step.name, step]));
  return names.map((name) => {
    const step = held.get(name);
    if (step === undefined) throw new Error(`the entry reader carries no form step ${name}`);
    return back ? reversed(step) : step;
  });
};

const EVENT_LINE = Buffer.from('{"kind":"event",', 'utf8');

const keptEvent = (line: Buffer, form: RecordForm): boolean =>
  !form.events && line.length > EVENT_LINE.length && line.subarray(0, EVENT_LINE.length).equals(EVENT_LINE);

function currentLine(line: string, at: number, { form }: RecordForm): Line {
  let record: { kind?: unknown; meta?: unknown; row?: { kind?: unknown; payload?: unknown } };
  try {
    record = JSON.parse(line) as typeof record;
  } catch {
    throw new LineUnformable(`the line ending at byte ${at} is not JSON`);
  }
  const header = record.kind === undefined && isMetaRecord(record);
  const kind = header || record.kind === 'meta' ? 'meta' : record.kind === 'event' ? 'event' : null;
  const held = header ? record : kind === 'meta' ? record.meta : record.row?.payload;
  if (kind === null || held === undefined) return KEPT;
  let formed: ReturnType<RecordForm['form']>;
  try {
    formed = form(kind, held);
  } catch (failure) {
    if (failure instanceof ThreadFormRefused) throw new LineUnformable(`the line ending at byte ${at}: ${failure.message}`);
    throw failure;
  }
  if (!formed.changed) return KEPT;
  return {
    current: JSON.stringify(
      header
        ? formed.value
        : kind === 'meta'
          ? { ...record, meta: formed.value }
          : { ...record, row: { ...record.row, payload: formed.value } },
    ),
  };
}

async function written(sink: Writable, bytes: Buffer): Promise<void> {
  if (!sink.write(bytes)) await once(sink, 'drain');
}

async function formLines(source: AsyncIterable<Buffer>, sink: Writable, wanted: ReadonlySet<number>, form: RecordForm): Promise<Formed> {
  let broken: Error | null = null;
  sink.on('error', (error) => {
    broken = error;
  });
  try {
    return await formInto(source, sink, wanted, form, () => broken);
  } finally {
    sink.destroy();
  }
}

async function formInto(
  source: AsyncIterable<Buffer>,
  sink: Writable,
  wanted: ReadonlySet<number>,
  form: RecordForm,
  broken: () => Error | null,
): Promise<Formed> {
  const moved = new Map<number, number>();
  const hash = createHash('sha256');
  let changed = false;
  let parts: Buffer[] = [];
  let read = 0;
  let wrote = 0;
  const emit = async (line: Buffer, newline: boolean): Promise<void> => {
    const failure = broken();
    if (failure !== null) throw failure;
    read += line.length + (newline ? 1 : 0);
    const formed = newline && !keptEvent(line, form) ? currentLine(line.toString('utf8'), read, form) : KEPT;
    const current = formed.current;
    const out = current === null ? line : Buffer.from(current, 'utf8');
    if (current !== null) changed = true;
    const bytes = newline ? Buffer.concat([out, Buffer.from('\n')]) : out;
    hash.update(bytes);
    await written(sink, bytes);
    wrote += bytes.length;
    if (newline && wanted.has(read)) moved.set(read, wrote);
  };
  for await (const chunk of source) {
    let from = 0;
    for (let newline = chunk.indexOf(0x0a); newline !== -1; newline = chunk.indexOf(0x0a, from)) {
      parts.push(chunk.subarray(from, newline));
      await emit(parts.length === 1 ? parts[0]! : Buffer.concat(parts), true);
      parts = [];
      from = newline + 1;
    }
    if (from < chunk.length) parts.push(chunk.subarray(from));
  }
  if (parts.length > 0) await emit(Buffer.concat(parts), false);
  const failure = broken();
  if (failure !== null) throw failure;
  sink.end();
  await once(sink, 'finish');
  return { changed, moved, sha256: hash.digest('hex') };
}

function packedSource(packed: string, read: ReadRollout): Readable {
  const source = rolloutStream(packed, read);
  const opened = createZstdDecompress();
  source.on('error', (error) => opened.destroy(error));
  return source.pipe(opened);
}

const hashing = (hash: Hash) =>
  new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });

async function staged(
  rollout: RolloutFiles,
  form: RolloutStage['form'],
  wanted: ReadonlySet<number>,
  lines: RecordForm,
  read: ReadRollout,
  suffix: string,
): Promise<{ readonly formed: Formed; readonly staged: string; readonly published: string }> {
  const forming = `${rollout.path}${suffix}`;
  const source = form === 'plain' ? rolloutStream(rollout.path, read) : packedSource(rollout.packed, read);
  const formed = await formLines(source, createWriteStream(forming), wanted, lines);
  if (form === 'plain' || !formed.changed) return { formed, staged: forming, published: rollout.path };
  const hash = createHash('sha256');
  await pipeline(rolloutStream(forming, read), createZstdCompress(), hashing(hash), createWriteStream(`${rollout.packed}${suffix}`));
  await rm(forming, { force: true });
  return { formed: { ...formed, sha256: hash.digest('hex') }, staged: `${rollout.packed}${suffix}`, published: rollout.packed };
}

export async function stageRolloutFile(
  rollout: RolloutFiles,
  stage: RolloutStage,
  kinds: ThreadEntryReader,
  read: ReadRollout,
): Promise<StagedFile> {
  const lines = recordForm(kinds, named(kinds, stage.steps, stage.back));
  try {
    const { formed, staged: at, published } = await staged(rollout, stage.form, new Set(stage.wanted), lines, read, stage.suffix);
    return { kind: 'staged', changed: formed.changed, moved: [...formed.moved], sha256: formed.sha256, staged: at, published };
  } catch (failure) {
    if (failure instanceof LineUnformable) return { kind: 'unformable', reason: failure.message };
    throw failure;
  }
}
