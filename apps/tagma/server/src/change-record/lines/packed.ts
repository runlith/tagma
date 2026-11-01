import { arrayView } from '@runlith/utils/collection';
import type { Mark } from './marks.js';
import type { MarkedLine, Proven, Verdict } from './projection.js';

type Columns = {
  readonly positions: Float64Array;
  readonly indices: Uint32Array;
  readonly kinds: Uint8Array;
  readonly follows: Float64Array;
  readonly removals: Float64Array;
};

type Summary = Omit<Proven, 'lines' | 'regions'>;

export type PackedVerdict = { readonly bytes: number } & (
  | { readonly kind: 'unknown'; readonly value: Extract<Verdict, { verdict: 'unknown' }> }
  | {
      readonly kind: 'proven';
      readonly summary: Summary;
      readonly lines: Columns | 'unweighed';
      readonly regions: Columns;
      readonly ranges: Float64Array;
      readonly text: string;
      readonly offsets: Float64Array;
      readonly marks: readonly Mark[];
      readonly rows: readonly string[];
    }
);

const stringBytes = (text: string): number => 64 + text.length * 2;

export function packVerdict(verdict: Verdict, limit: number): PackedVerdict | null {
  if (verdict.verdict === 'unknown') {
    const bytes = 512 + JSON.stringify(verdict).length * 2 + verdict.writers.length * 256;
    return bytes > limit ? null : { kind: 'unknown', value: verdict, bytes };
  }
  const { lines, regions, ...summary } = verdict;
  const count = (lines === 'unweighed' ? 0 : lines.length) + regions.reduce((sum, region) => sum + region.lines.length, 0);
  if (count * 25 > limit) return null;
  let bytes = 1024;
  const texts = new Map<string, number>();
  const marks: Mark[] = ['external'];
  const owners = new Map<string, number>();
  const rows: string[] = [];
  const removers = new Map<string, number>();
  const intern = (text: string): number => {
    const known = texts.get(text);
    if (known !== undefined) return known;
    const index = texts.size;
    texts.set(text, index);
    bytes += text.length * 2 + 8;
    return index;
  };
  const owner = (mark: Mark): number => {
    if (mark === 'external') return 0;
    const known = owners.get(mark.row);
    if (known !== undefined) return known;
    const index = marks.length;
    marks.push(mark);
    owners.set(mark.row, index);
    bytes += 128 + stringBytes(mark.row) + stringBytes(mark.holder);
    return index;
  };
  const remover = (row: string): number => {
    const known = removers.get(row);
    if (known !== undefined) return known;
    const index = rows.length;
    rows.push(row);
    removers.set(row, index);
    bytes += stringBytes(row);
    return index;
  };
  const columns = (given: readonly MarkedLine[]): Columns => {
    const positions = new Float64Array(given.length * 2);
    const indices = new Uint32Array(given.length * 2);
    const kinds = new Uint8Array(given.length);
    const follows = given.some((line) => line.follows !== undefined) ? new Float64Array(given.length).fill(NaN) : new Float64Array();
    const removals = given.some((line) => line.removal !== undefined) ? new Float64Array(given.length * 2).fill(NaN) : new Float64Array();
    for (const [at, line] of given.entries()) {
      positions[at * 2] = line.at;
      positions[at * 2 + 1] = line.unit;
      indices[at * 2] = owner(line.mark);
      indices[at * 2 + 1] = intern(line.text);
      kinds[at] = line.kind === 'added' ? 1 : 0;
      if (line.follows !== undefined) follows[at] = line.follows;
      if (line.removal !== undefined) {
        removals[at * 2] = remover(line.removal.row);
        removals[at * 2 + 1] = line.removal.ordinal;
      }
    }
    bytes += positions.byteLength + indices.byteLength + kinds.byteLength + follows.byteLength + removals.byteLength + 640;
    return { positions, indices, kinds, follows, removals };
  };
  const packed = lines === 'unweighed' ? lines : columns(lines);
  const slices = columns(regions.flatMap((region) => region.lines));
  const ranges = new Float64Array(regions.length * 5);
  let end = 0;
  for (const [at, region] of regions.entries()) {
    end += region.lines.length;
    ranges.set([region.before.start, region.before.end, region.after.start, region.after.end, end], at * 5);
  }
  bytes += ranges.byteLength + 128;
  for (const hand of summary.hands) bytes += 128 + stringBytes(hand.holder);
  for (const row of summary.standing) bytes += 64 + stringBytes(row);
  for (const [row, overwritten] of summary.overwritten) {
    bytes += 128 + stringBytes(row);
    for (const other of overwritten) bytes += 16 + stringBytes(other);
  }
  bytes += summary.links.length * 128;
  if (bytes > limit) return null;
  const values = [...texts.keys()];
  const offsets = new Float64Array(values.length + 1);
  let length = 0;
  for (const [at, text] of values.entries()) {
    offsets[at] = length;
    length += text.length;
  }
  offsets[values.length] = length;
  return { kind: 'proven', summary, lines: packed, regions: slices, ranges, text: values.join(''), offsets, marks, rows, bytes };
}

export function unpackVerdict(packed: PackedVerdict): Verdict {
  if (packed.kind === 'unknown') return packed.value;
  const columns = (given: Columns, start = 0, end = given.kinds.length): readonly MarkedLine[] =>
    arrayView(end - start, (index) => {
      const at = start + index;
      const text = given.indices[at * 2 + 1]!;
      const follows = given.follows[at];
      const removal = given.removals[at * 2];
      return {
        kind: given.kinds[at] === 1 ? 'added' : 'removed',
        at: given.positions[at * 2]!,
        unit: given.positions[at * 2 + 1]!,
        mark: packed.marks[given.indices[at * 2]!]!,
        text: packed.text.slice(packed.offsets[text], packed.offsets[text + 1]),
        follows: follows === undefined || Number.isNaN(follows) ? undefined : follows,
        removal:
          removal === undefined || Number.isNaN(removal) ? undefined : { row: packed.rows[removal]!, ordinal: given.removals[at * 2 + 1]! },
      };
    });
  return {
    ...packed.summary,
    lines: packed.lines === 'unweighed' ? 'unweighed' : columns(packed.lines),
    regions: arrayView(packed.ranges.length / 5, (index) => {
      const at = index * 5;
      return {
        before: { start: packed.ranges[at]!, end: packed.ranges[at + 1]! },
        after: { start: packed.ranges[at + 2]!, end: packed.ranges[at + 3]! },
        lines: columns(packed.regions, at === 0 ? 0 : packed.ranges[at - 1]!, packed.ranges[at + 4]!),
      };
    }),
  };
}
