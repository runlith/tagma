export const RECORD_BYTES = 64;
export const COMPACTION_MIN = 64;

const ID = /^[0-9a-f]{12}$/;
const VERSION_WIDTH = 28;
const PREV_WIDTH = 16;
const COUNT_WIDTH = 2;
const NO_PREV = '-'.repeat(PREV_WIDTH);
const PREV_AT = 13 + VERSION_WIDTH + 1;
const COUNT_AT = PREV_AT + PREV_WIDTH + 1;

export type OrderRecord = { readonly id: string; readonly version: string; readonly prev: number; readonly versions: number };

export type Snapshot = { readonly epoch: number; readonly snapshot: number; readonly total: number };

export type WalkKey = Snapshot & { readonly seq: number };

export type OrderLog = {
  readonly epoch: number;
  readonly confirmed: number;
  readonly live: number;
  readonly records: (from: number, to: number) => readonly (OrderRecord | null)[];
  readonly head: (id: string) => number | null | 'broken';
};

export type Walked = { readonly id: string; readonly version: string; readonly versions: number; readonly key: WalkKey };

export type Walk =
  | { readonly kind: 'rows'; readonly rows: readonly Walked[]; readonly more: boolean }
  | { readonly kind: 'stale' }
  | { readonly kind: 'broken' };

export const encodeRecord = (record: OrderRecord): string => {
  if (
    !ID.test(record.id) ||
    record.version.length === 0 ||
    record.version.length > VERSION_WIDTH ||
    record.version.includes(' ') ||
    !Number.isInteger(record.versions) ||
    record.versions < 1 ||
    record.versions >= 10 ** COUNT_WIDTH
  ) {
    throw new Error(`an order record cannot hold ${record.id} ${record.version} ${record.versions}`);
  }
  const prev = record.prev < 0 ? NO_PREV : record.prev.toString(16).padStart(PREV_WIDTH, '0');
  const line = `${record.id} ${record.version.padEnd(VERSION_WIDTH)} ${prev} ${String(record.versions).padStart(COUNT_WIDTH, '0')}`;
  return `${line.padEnd(RECORD_BYTES - 1)}\n`;
};

export const decodeRecord = (text: string): OrderRecord | null => {
  if (text.length !== RECORD_BYTES || text[RECORD_BYTES - 1] !== '\n') return null;
  const id = text.slice(0, 12);
  const version = text.slice(13, 13 + VERSION_WIDTH).trimEnd();
  const prevText = text.slice(PREV_AT, PREV_AT + PREV_WIDTH);
  const countText = text.slice(COUNT_AT, COUNT_AT + COUNT_WIDTH);
  if (!ID.test(id) || version.length === 0 || version.includes(' ') || !/^\d+$/.test(countText)) return null;
  const versions = Number(countText);
  if (versions < 1) return null;
  if (prevText === NO_PREV) return { id, version, prev: -1, versions };
  if (!/^[0-9a-f]+$/.test(prevText)) return null;
  return { id, version, prev: Number.parseInt(prevText, 16), versions };
};

export const compacts = (confirmed: number, live: number, retryAt = 0): boolean =>
  confirmed >= retryAt && confirmed - live >= Math.max(live, COMPACTION_MIN);

export const retryAfter = (confirmed: number, live: number): number => confirmed + Math.max(live, COMPACTION_MIN);

export const SUPERSEDED_BOUND = 4;

export const supersededCeiling = (live: number): number => SUPERSEDED_BOUND * Math.max(live, COMPACTION_MIN);

export const admits = (confirmed: number, live: number, fresh: boolean): boolean => {
  const standing = live + (fresh ? 1 : 0);
  return confirmed + 1 - standing <= supersededCeiling(standing);
};

const CHUNK = 256;

export const walk = (log: OrderLog, after: WalkKey | null, limit: number): Walk => {
  if (after !== null && after.epoch !== log.epoch) return { kind: 'stale' };
  const at: Snapshot = after ?? { epoch: log.epoch, snapshot: log.confirmed, total: log.live };
  if (at.snapshot > log.confirmed) return { kind: 'stale' };
  const standing = new Map<string, number | null>();
  const standingAt = (id: string): number | null | 'broken' => {
    const known = standing.get(id);
    if (known !== undefined) return known;
    const head = log.head(id);
    if (head === null) {
      standing.set(id, null);
      return null;
    }
    if (head === 'broken' || head >= log.confirmed) return 'broken';
    let seq = head;
    while (seq >= at.snapshot) {
      const record = log.records(seq, seq + 1)[0] ?? null;
      if (record === null || record.id !== id) return 'broken';
      seq = record.prev;
      if (seq < 0) break;
    }
    const held = seq < 0 ? null : seq;
    standing.set(id, held);
    return held;
  };
  const rows: Walked[] = [];
  let seq = (after?.seq ?? at.snapshot) - 1;
  while (seq >= 0) {
    const from = Math.max(0, seq - CHUNK + 1);
    const chunk = log.records(from, seq + 1);
    for (let index = chunk.length - 1; index >= 0; index -= 1, seq -= 1) {
      const record = chunk[index] ?? null;
      if (record === null) return { kind: 'broken' };
      const held = standingAt(record.id);
      if (held === 'broken') return { kind: 'broken' };
      if (held !== seq) continue;
      if (rows.length === limit) return { kind: 'rows', rows, more: true };
      rows.push({ id: record.id, version: record.version, versions: record.versions, key: { ...at, seq } });
    }
  }
  return { kind: 'rows', rows, more: false };
};
