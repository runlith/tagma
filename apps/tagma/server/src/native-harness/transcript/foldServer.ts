/// <reference types="bun" />

import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { Schema } from 'effect';
import type { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { decodeThreadEventPayloadResult, parseThreadRunUsage } from '@runlith/agent/thread/persisted';
import type { ThreadCompactionCheckpointRow } from '@runlith/agent/thread/rows';
import { revived } from '../../threads/journal/rolloutMeta.js';
import { HistoryFold } from '@runlith/agent/thread/HistoryFold';
import { TranscriptFold } from '@runlith/agent/transcript/TranscriptFold';
import { entryOf, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { RolloutLineUnreadable, factOf } from '../../threads/journal/restedReads.js';
import { stageRolloutFile } from '../../threads/journal/rolloutStaging.js';
import { planCarry, rolloutLayers } from '../../threads/journal/rolloutCarry.js';
import type { FoldRow } from '../../threads/journal/rolloutMeta.js';
import { nativeRows } from '../rolloutFolds.js';
import type { RolloutFiles, TranscriptKey } from '../../threads/contract/service/rested.js';
import { wireWeight } from './rows.js';
import {
  TRANSCRIPT_FOOTER_BYTES,
  TRANSCRIPT_FORM,
  TRANSCRIPT_SLOT_BYTES,
  type RestedAnswer,
  type RestedAsk,
  type RestedRead,
  type RestedTell,
  type RestedCompaction,
} from './restedWork.js';
import { readRolloutLine, recordVerdict, rolloutStream, wholeLinesOf } from '../../threads/journal/rolloutFile.js';
import { totalledReads, type ReadRollout } from '../../threads/contract/service/rolloutReads.js';

declare const self: Worker;

const FLUSH_BYTES = 1024 * 1024;

const missing = (cause: unknown): boolean => (cause as NodeJS.ErrnoException).code === 'ENOENT';

async function source(rollout: RolloutFiles, read: ReadRollout, retried = false): Promise<Readable> {
  try {
    return rolloutStream(rollout.path, read, await open(rollout.path, 'r'));
  } catch (cause) {
    if (!missing(cause)) throw cause;
  }
  try {
    const packed = rolloutStream(rollout.packed, read, await open(rollout.packed, 'r'));
    const unpacked = createZstdDecompress();
    packed.on('error', (cause) => unpacked.destroy(cause));
    return packed.pipe(unpacked);
  } catch (cause) {
    if (!missing(cause) || retried) throw cause;
  }
  return source(rollout, read, true);
}

async function* facts(
  rollout: RolloutFiles,
  kinds: ThreadEntryReader,
  read: ReadRollout,
): AsyncGenerator<NonNullable<ReturnType<typeof factOf>>> {
  const decode = (value: unknown) => decodeThreadEventPayloadResult(kinds, value);
  const decoder = new TextDecoder();
  let rest = '';
  let corrupt = 0;
  let first = '';
  for await (const chunk of await source(rollout, read)) {
    const lines = (rest + decoder.decode(chunk as Uint8Array, { stream: true })).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      let fact: ReturnType<typeof factOf>;
      try {
        fact = factOf(line, decode);
      } catch (failure) {
        if (!(failure instanceof RolloutLineUnreadable)) throw failure;
        if (corrupt === 0) first = failure.message;
        corrupt += 1;
        continue;
      }
      if (fact !== null) yield fact;
    }
  }
  if (corrupt > 0) throw new RolloutLineUnreadable(`${rollout.path}: ${corrupt} rollout line(s) cannot be read; ${first}`);
  if (rest + decoder.decode() !== '') throw new RolloutLineUnreadable(`${rollout.path}: the rollout ends inside a line`);
}

async function transcribe(rollout: RolloutFiles, key: TranscriptKey, kinds: ThreadEntryReader, read: ReadRollout): Promise<number> {
  const fold = new TranscriptFold([]);
  for await (const fact of facts(rollout, kinds, read)) fold.place(fact.fact);
  const entries = fold.take();
  const target = rollout.transcript;
  const partial = `${target}.partial`;
  const handle = await open(partial, 'w');
  let written = false;
  try {
    const slots = Buffer.alloc(entries.length * TRANSCRIPT_SLOT_BYTES);
    const open: number[] = [];
    let at = 0;
    let pending: string[] = [];
    let held = 0;
    const flush = async (file: FileHandle): Promise<void> => {
      if (pending.length === 0) return;
      await file.write(pending.join(''));
      pending = [];
      held = 0;
    };
    for (const [ord, entry] of entries.entries()) {
      const json = JSON.stringify(entry);
      const line = `${json}\n`;
      slots.writeDoubleLE(at, ord * TRANSCRIPT_SLOT_BYTES);
      slots.writeDoubleLE(wireWeight(entry.type, json.length), ord * TRANSCRIPT_SLOT_BYTES + 8);
      const start = at;
      at += Buffer.byteLength(line, 'utf8');
      if (entryOf('question')(entry) && entry.status === 'open') open.push(ord, start, at);
      pending.push(line);
      held += line.length;
      if (held >= FLUSH_BYTES) await flush(handle);
    }
    await flush(handle);
    const opens = Buffer.alloc(open.length * 8);
    for (const [index, value] of open.entries()) opens.writeDoubleLE(value, index * 8);
    const footer = Buffer.alloc(TRANSCRIPT_FOOTER_BYTES);
    footer.writeDoubleLE(entries.length, 0);
    footer.writeDoubleLE(at, 8);
    footer.writeDoubleLE(open.length / 3, 16);
    footer.writeDoubleLE(key.bytes, 24);
    footer.writeDoubleLE(key.position, 32);
    footer.writeDoubleLE(TRANSCRIPT_FORM, 40);
    await handle.write(slots);
    await handle.write(opens);
    await handle.write(footer);
    written = true;
  } finally {
    await handle.close();
    if (!written) await rm(partial, { force: true });
  }
  await rename(partial, target);
  return entries.length;
}

async function history(
  rollout: RolloutFiles,
  kinds: ThreadEntryReader,
  read: ReadRollout,
): Promise<{ readonly history: ReturnType<HistoryFold['take']>; readonly bytes: number }> {
  const fold = new HistoryFold();
  for await (const fact of facts(rollout, kinds, read)) fold.fold({ kind: fact.kind, payload: fact.payload }, fact.position);
  const folded = fold.take();
  return { history: folded, bytes: Buffer.byteLength(JSON.stringify(folded), 'utf8') };
}

const checkpointRow = Schema.decodeUnknownSync(
  Schema.Struct({
    id: Schema.String,
    threadId: Schema.String,
    sourceRunId: Schema.NullOr(Schema.String),
    coveredMessageCount: Schema.Number,
    coveredPrefixHash: Schema.String,
    summary: Schema.String,
    usage: Schema.Unknown,
    createdAt: Schema.Date,
  }),
);
const prunedRow = Schema.decodeUnknownSync(Schema.Struct({ toolCallId: Schema.String, tokens: Schema.Number }));
const retiredRow = Schema.decodeUnknownSync(Schema.Struct({ toolCallId: Schema.String }));

async function compaction(rollout: RolloutFiles, read: ReadRollout): Promise<RestedCompaction> {
  const checkpoints = new Set<string>();
  const pruned = new Map<string, number>();
  let latest: ThreadCompactionCheckpointRow | null = null;
  let opening = true;
  for await (const line of wholeLinesOf(await source(rollout, read))) {
    if (line === '') continue;
    const decoded = readRolloutLine(line);
    if ('failure' in decoded) throw new RolloutLineUnreadable(`${rollout.path}: ${decoded.failure}`);
    if (opening) {
      opening = false;
      continue;
    }
    const record = recordVerdict(decoded.record);
    if (record.kind === 'unreadable') throw new RolloutLineUnreadable(`${rollout.path}: ${record.reason}`);
    if (record.kind === 'read-past') continue;
    if (record.record === 'checkpoint') {
      const row = checkpointRow(revived(record.row));
      if (checkpoints.has(row.id)) continue;
      checkpoints.add(row.id);
      if (
        latest === null ||
        row.createdAt > latest.createdAt ||
        (row.createdAt.getTime() === latest.createdAt.getTime() && row.id > latest.id)
      ) {
        latest = { ...row, usage: parseThreadRunUsage(row.usage) };
      }
    } else if (record.record === 'pruned') {
      const row = prunedRow(record.row);
      if (!pruned.has(row.toolCallId)) pruned.set(row.toolCallId, row.tokens);
    } else if (record.record === 'pruned-retired') pruned.delete(retiredRow(record.row).toolCallId);
  }
  let tokens = 0;
  for (const volume of pruned.values()) tokens += volume;
  const summary = { checkpoints: checkpoints.size, latest, calls: [...pruned.keys()], pruned: { count: pruned.size, tokens } };
  return { ...summary, bytes: Buffer.byteLength(JSON.stringify(summary), 'utf8') };
}

const writing = new Map<string, Promise<number>>();

function transcribed(rollout: RolloutFiles, key: TranscriptKey, kinds: ThreadEntryReader, read: ReadRollout): Promise<number> {
  const before = writing.get(rollout.transcript) ?? Promise.resolve(0);
  const turn = before.then(
    () => transcribe(rollout, key, kinds, read),
    () => transcribe(rollout, key, kinds, read),
  );
  writing.set(rollout.transcript, turn);
  const settled = (): void => {
    if (writing.get(rollout.transcript) === turn) writing.delete(rollout.transcript);
  };
  turn.then(settled, settled);
  return turn;
}

const plans = new Map<number, (readonly FoldRow[] | null)[]>();

async function carried(ask: Extract<RestedAsk, { readonly kind: 'carry' }>, kinds: ThreadEntryReader, read: ReadRollout) {
  const { opening, units } = await planCarry(ask.rollout.path, ask.carry, kinds, read, nativeRows);
  if (units.length > 0) plans.set(ask.id, [...units]);
  return { id: ask.id, kind: 'carrying', plan: ask.id, opening } satisfies RestedAnswer;
}

function taken(ask: Extract<RestedAsk, { readonly kind: 'carry-take' }>): RestedAnswer {
  const units = plans.get(ask.plan);
  const rows = units?.[ask.unit];
  if (units === undefined || rows == null)
    return { id: ask.id, kind: 'failed', reason: `carry plan ${ask.plan} holds no unit ${ask.unit}` };
  units[ask.unit] = null;
  if (units.every((unit) => unit === null)) plans.delete(ask.plan);
  return { id: ask.id, kind: 'carried', rows };
}

async function answered(ask: RestedAsk, kinds: ThreadEntryReader): Promise<RestedAnswer> {
  const totals = totalledReads();
  const read = totals.observe;
  try {
    if (ask.kind === 'compaction') return { id: ask.id, kind: 'compaction', summary: await compaction(ask.rollout, read) };
    if (ask.kind === 'transcribe')
      return { id: ask.id, kind: 'transcribed', entries: await transcribed(ask.rollout, ask.key, kinds, read) };
    if (ask.kind === 'stage') return { id: ask.id, kind: 'staged', file: await stageRolloutFile(ask.rollout, ask.stage, kinds, read) };
    if (ask.kind === 'carry') return await carried(ask, kinds, read);
    if (ask.kind === 'carry-take') return taken(ask);
    if (ask.kind === 'layers') return { id: ask.id, kind: 'layers', layers: await rolloutLayers(ask.rollout.path, read) };
    return { id: ask.id, kind: 'history', ...(await history(ask.rollout, kinds, read)) };
  } finally {
    const reads = totals.drain();
    if (reads.length > 0) self.postMessage({ id: ask.id, kind: 'read', reads } satisfies RestedRead);
  }
}

export function serveRestedFolds(kinds: ThreadEntryReader): void {
  self.addEventListener('message', (event: MessageEvent<RestedAsk | RestedTell>) => {
    if (event.data.kind === 'carry-drop') {
      plans.delete(event.data.plan);
      return;
    }
    const asked = event.data;
    answered(asked, kinds).then(
      (answer) => self.postMessage(answer),
      (cause) =>
        self.postMessage({
          id: asked.id,
          kind: 'failed',
          reason: cause instanceof Error ? cause.message : String(cause),
        } satisfies RestedAnswer),
    );
  });
}
