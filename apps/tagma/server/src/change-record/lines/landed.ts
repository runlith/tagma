import * as Schema from 'effect/Schema';
import { contentLines, digestKey, type FoldState, type TextContent } from './folding.js';
import { joined, keyOf, leaf, lookup, runsOf, sizeOf, sliced, type Point, type Rope, type Source } from './marks.js';

const RemovalSchema = Schema.Struct({ row: Schema.String, ordinal: Schema.Number });
export type Removal = typeof RemovalSchema.Type;

export const LandedPieceSchema = Schema.Struct({
  side: Schema.Literals(['head', 'working']),
  start: Schema.Number,
  count: Schema.Number,
  removal: Schema.optional(RemovalSchema),
});
export type LandedPiece = typeof LandedPieceSchema.Type;

export type Landed = {
  readonly digest: string;
  readonly head: string | null;
  readonly working: string | null;
  readonly pieces: readonly LandedPiece[];
};

type Recalled = { readonly root: Rope };

type RemovedRun = { readonly source: Source; readonly offset: number; readonly count: number; readonly ordinal: number };

type RowRemovals = { readonly runs: readonly RemovedRun[]; readonly bySource: ReadonlyMap<Source, readonly RemovedRun[]> };

export type Removals = (row: string) => RowRemovals | undefined;

const covering = (runs: readonly RemovedRun[], key: (run: RemovedRun) => number, value: number): number => {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (key(runs[mid]!) <= value) low = mid + 1;
    else high = mid;
  }
  return low - 1;
};

export function rowRemovals(state: FoldState): Removals {
  const known = new Map<string, RowRemovals | undefined>();
  return (row) => {
    if (known.has(row)) return known.get(row);
    const written = lookup(state.snapshot.byRow, row);
    let found: RowRemovals | undefined;
    if (written !== undefined) {
      const runs: RemovedRun[] = [];
      const bySource = new Map<Source, RemovedRun[]>();
      let ordinal = 0;
      for (const source of [...written].sort((one, two) => one.serial - two.serial))
        for (const run of runsOf(source.removed)) {
          const removed = { source: run.source, offset: run.offset, count: run.count, ordinal };
          runs.push(removed);
          const same = bySource.get(run.source);
          if (same === undefined) bySource.set(run.source, [removed]);
          else same.push(removed);
          ordinal += run.count;
        }
      for (const same of bySource.values()) same.sort((one, two) => one.offset - two.offset);
      found = { runs, bySource };
    }
    known.set(row, found);
    return found;
  };
}

export const removalAt = (removals: Removals, remover: Source, point: Point): Removal | undefined => {
  if (typeof remover.mark === 'string') return undefined;
  const runs = removals(remover.mark.row)?.bySource.get(point.source);
  const run = runs === undefined ? undefined : runs[covering(runs, (one) => one.offset, point.offset)];
  return run === undefined || point.offset >= run.offset + run.count
    ? undefined
    : { row: remover.mark.row, ordinal: run.ordinal + point.offset - run.offset };
};

export function landedRoot(
  state: FoldState,
  head: TextContent,
  landed: readonly Landed[],
  removals: Removals,
  fill?: (at: number, count: number) => Rope,
): Recalled | 'unfilled' | undefined {
  if (head.digest === null || landed.length === 0) return undefined;
  const compositions = new Map(landed.map((one) => [one.digest, one] as const));
  const lines = contentLines(head);
  const resolving = new Set<string>();
  let unfilled = false;
  const removed = (removal: Removal, count: number, at: number | null): Rope | undefined => {
    const runs = removals(removal.row)?.runs;
    if (runs === undefined) return undefined;
    let rope: Rope = null;
    let index = covering(runs, (one) => one.ordinal, removal.ordinal);
    for (let taken = 0; taken < count; index += 1) {
      const run = runs[index];
      const ordinal = removal.ordinal + taken;
      if (run === undefined || ordinal < run.ordinal || ordinal >= run.ordinal + run.count) return undefined;
      const offset = run.offset + ordinal - run.ordinal;
      const length = Math.min(count - taken, run.ordinal + run.count - ordinal);
      for (let step = 0; at !== null && step < length; step += 1) {
        const text = run.source.lines[offset + step];
        const line = lines[at + taken + step];
        if (text === undefined || line === undefined || keyOf(text, state.normalized) !== keyOf(line, state.normalized)) return undefined;
      }
      rope = joined(rope, leaf({ source: run.source, offset, count: length }));
      taken += length;
    }
    return rope;
  };
  const recall = (digest: string | null, top: boolean): Recalled | undefined => {
    const known = lookup(state.snapshots, digestKey(digest));
    if (known !== undefined) return known;
    const composition = digest === null ? undefined : compositions.get(digest);
    if (composition === undefined || resolving.has(composition.digest)) return undefined;
    resolving.add(composition.digest);
    const working = recall(composition.working, false);
    const older = composition.pieces.some((piece) => piece.side === 'head') ? recall(composition.head, false) : undefined;
    resolving.delete(composition.digest);
    if (working === undefined) return undefined;
    let root: Rope = null;
    let at = 0;
    for (const piece of composition.pieces) {
      const from = piece.side === 'working' ? working : older;
      if (from !== undefined) {
        if (piece.start + piece.count > sizeOf(from.root)) return undefined;
        root = joined(root, sliced(from.root, piece.start, piece.count));
      } else {
        const exact = piece.removal === undefined ? undefined : removed(piece.removal, piece.count, top ? at : null);
        if (exact !== undefined) root = joined(root, exact);
        else {
          if (!top) return undefined;
          if (fill === undefined) {
            unfilled = true;
            return undefined;
          }
          root = joined(root, fill(at, piece.count));
        }
      }
      at += piece.count;
    }
    return top && at !== lines.length ? undefined : { root };
  };
  const found = recall(head.digest, true);
  return unfilled ? 'unfilled' : found;
}
