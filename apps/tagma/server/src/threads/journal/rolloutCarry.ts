import { createHash } from 'node:crypto';
import { Result, type Effect } from 'effect';
import { decodeThreadEventPayloadResult } from '@runlith/agent/thread/persisted';
import { crossingEntry, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { ReadRollout } from '../contract/service/rolloutReads.js';
import { recordVerdict, rolloutEventOf, scanRolloutFile, type RolloutRecord, type RolloutUnreadable } from './rolloutFile.js';
import { revived, type CarriedRecord, type FoldRow, type Row, type RolloutLayer, type RolloutMeta } from './rolloutMeta.js';

const CARRY_UNIT_PARAMS = 60_000;
//! One unit is one handover from the worker and one store unit, so the loop decodes and writes it in a bounded pass.
const CARRY_UNIT_BYTES = 4 * 1024 * 1024;

export type CarrySource = { readonly sourceId: string; readonly path: string };

export type CarryAsk = {
  readonly threadId: string | null;
  readonly native: boolean | null;
  readonly standing: readonly string[];
  readonly sources: readonly CarrySource[] | null;
  readonly published?: { readonly bytes: number; readonly fingerprint: string };
};

export type CarryOpening =
  | { readonly kind: 'absent'; readonly absent: readonly string[]; readonly last: number }
  | { readonly kind: 'refused'; readonly reason: 'thread-missing' | 'record-shape'; readonly message: string }
  | {
      readonly kind: 'planned';
      readonly meta: unknown;
      readonly native: boolean;
      readonly bytes: number;
      readonly through: number;
      readonly records: number;
      readonly inherited: number;
      readonly holds: readonly Row[];
      readonly units: number;
    };

export type CarryPlan = { readonly opening: CarryOpening; readonly units: readonly (readonly FoldRow[])[] };

export type Carrying =
  | Exclude<CarryOpening, { readonly kind: 'planned' }>
  | (Extract<CarryOpening, { readonly kind: 'planned' }> & {
      readonly take: (unit: number) => Effect.Effect<readonly FoldRow[], RolloutUnreadable>;
      readonly drop: Effect.Effect<void>;
    });

export type NativeRows = (threadId: string, records: readonly CarriedRecord[]) => readonly FoldRow[];

type Read = { readonly meta: unknown; readonly items: readonly RolloutRecord[]; readonly bytes: number; readonly prefix: string | null };

const refused = (reason: 'thread-missing' | 'record-shape', message: string): CarryPlan => ({
  opening: { kind: 'refused', reason, message },
  units: [],
});

async function readRollout(path: string, read: ReadRollout, through?: number): Promise<Read> {
  const items: RolloutRecord[] = [];
  const hash = through === undefined ? null : createHash('sha256');
  let reached = through === 0;
  const scan = await scanRolloutFile(
    path,
    (item) => items.push(item),
    read,
    hash === null
      ? undefined
      : (line, end) => {
          if (end > through!) return;
          hash.update(line).update('\n');
          reached = end === through;
        },
  );
  return { meta: scan.meta, items, bytes: scan.bytes, prefix: hash === null || !reached ? null : hash.digest('hex') };
}

const metaOf = (rollout: Read): Partial<RolloutMeta> | null => {
  const moved = rollout.items.filter((item) => item.kind === 'meta').at(-1);
  return (moved === undefined ? rollout.meta : moved.meta) as Partial<RolloutMeta> | null;
};

export async function rolloutLayers(path: string, read: ReadRollout): Promise<readonly RolloutLayer[]> {
  return metaOf(await readRollout(path, read))?.base ?? [];
}

async function prefixOf(
  threadId: string,
  base: readonly RolloutLayer[],
  sources: readonly CarrySource[],
  read: ReadRollout,
): Promise<readonly RolloutRecord[] | string> {
  const taken = new Map<number, RolloutRecord>();
  const scanned = new Map<string, readonly RolloutRecord[]>();
  for (const layer of base) {
    const source = sources.find((one) => one.sourceId === layer.sourceId);
    let items = scanned.get(layer.sourceId);
    if (items === undefined && source !== undefined) {
      items = (await readRollout(source.path, read)).items;
      scanned.set(layer.sourceId, items);
    }
    for (const item of items ?? []) {
      const event = rolloutEventOf(item);
      if (event === null || event.position <= layer.afterPosition || event.position > layer.throughPosition) continue;
      taken.set(event.position, { kind: 'event', row: { ...event, threadId, id: `${threadId}:${event.position}` } });
    }
  }
  for (const layer of base) {
    for (let position = layer.afterPosition + 1; position <= layer.throughPosition; position += 1) {
      if (!taken.has(position))
        return `thread ${threadId} reads position ${position} through ${layer.sourceId}, and no rollout of its sources holds it`;
    }
  }
  return [...taken].sort(([left], [right]) => left - right).map(([, record]) => record);
}

const positionOf = (record: RolloutRecord): number => rolloutEventOf(record)?.position ?? 0;

const inherited = (prefix: readonly RolloutRecord[], items: readonly RolloutRecord[]): readonly RolloutRecord[] => {
  const own = items.filter((item) => rolloutEventOf(item) !== null);
  const merged: RolloutRecord[] = [];
  let at = 0;
  for (const event of own) {
    while (at < prefix.length && positionOf(prefix[at]!) < positionOf(event)) merged.push(prefix[at++]!);
    merged.push(event);
  }
  merged.push(...prefix.slice(at));
  return [...merged, ...items.filter((item) => rolloutEventOf(item) === null)];
};

function sizeOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

const unitsOf = (rows: readonly FoldRow[]): readonly (readonly FoldRow[])[] => {
  const units: FoldRow[][] = [];
  let unit: FoldRow[] = [];
  let params = 0;
  let bytes = 0;
  for (const row of rows) {
    if (unit.length > 0 && (params + row.weight > CARRY_UNIT_PARAMS || bytes + row.bytes > CARRY_UNIT_BYTES)) {
      units.push(unit);
      unit = [];
      params = 0;
      bytes = 0;
    }
    unit.push(row);
    params += row.weight;
    bytes += row.bytes;
  }
  if (unit.length > 0) units.push(unit);
  return units;
};

export async function planCarry(
  path: string,
  ask: CarryAsk,
  kinds: ThreadEntryReader,
  read: ReadRollout,
  nativeRows: NativeRows,
): Promise<CarryPlan> {
  const rollout = await readRollout(path, read, ask.published?.bytes);
  if (ask.published !== undefined && rollout.prefix !== ask.published.fingerprint)
    return refused('record-shape', `the rollout ${path} no longer begins with the source its readers were answered from`);
  if (ask.standing.length > 0) {
    const filed = new Set<string>();
    let last = 0;
    for (const item of rollout.items) {
      const event = rolloutEventOf(item);
      if (event === null) continue;
      filed.add(event.id);
      last = Math.max(last, event.position);
    }
    const absent = ask.standing.filter((id) => !filed.has(id));
    if (absent.length > 0) return { opening: { kind: 'absent', absent, last }, units: [] };
  }
  const meta = metaOf(rollout);
  const base = meta?.base ?? [];
  let items = rollout.items;
  let prefix = 0;
  if (ask.sources !== null && base.length > 0 && meta?.record != null) {
    const taken = await prefixOf(String(meta.record.id), base, ask.sources, read);
    if (typeof taken === 'string') return refused('thread-missing', taken);
    prefix = taken.length;
    if (prefix > 0) items = inherited(taken, items);
  }
  const threadId = ask.threadId ?? String(meta?.record?.id ?? '');
  const native = ask.native ?? meta?.native != null;
  const records: CarriedRecord[] = [];
  const rows: FoldRow[] = [];
  const holds: Row[] = [];
  let through = 0;
  for (const item of items) {
    if (item.kind === 'hold' && item.row !== undefined) holds.push(revived(item.row));
    const verdict = recordVerdict(item);
    if (verdict.kind === 'unreadable') return refused('record-shape', verdict.reason);
    if (verdict.kind === 'read-past') continue;
    const row = revived(verdict.row);
    if (verdict.record !== 'event') {
      records.push({ record: verdict.record, row });
      continue;
    }
    const decoded = decodeThreadEventPayloadResult(kinds, row.payload);
    if (Result.isFailure(decoded))
      return refused('record-shape', `the event at position ${verdict.position} cannot be read: ${decoded.failure.message}`);
    const { entry } = decoded.success;
    const event = { ...row, payload: entry === undefined ? decoded.success : { ...decoded.success, entry: crossingEntry(entry) } };
    records.push({ record: 'event', row: event, event: { kind: String(row.kind), payload: decoded.success } });
    through = verdict.position;
    rows.push({ kind: 'event', row: event, weight: 5, bytes: sizeOf(event) });
  }
  if (native) rows.push(...nativeRows(threadId, records));
  const units = unitsOf(rows);
  return {
    opening: {
      kind: 'planned',
      meta,
      native,
      bytes: rollout.bytes,
      through,
      records: records.length,
      inherited: prefix,
      holds,
      units: units.length,
    },
    units,
  };
}
