import type { Change, Deadline } from '@runlith/utils/sequenceDiff';
import { alignWindow, matchedRuns, type Aligned, type Match } from './alignment.js';
import { completeFold, askFold, type FoldWork } from './jobs.js';
import { sliceLines, shareText, type TextSlice } from './text.js';
import type { NetWindow } from './net.js';
import { contentLines, digestKey, type Content, type FoldState, type Snapshot, type TextContent, type Unknown } from './folding.js';
import { anchorsOf, frameOf, gapsOf, indexOf, pointIn, walkFrame, type Frame, type RemovalIndex } from './intervals.js';
import { landedRoot, removalAt, rowRemovals, type Landed, type Removal, type Removals } from './landed.js';
import {
  bufferOf,
  joined,
  keyOf,
  leaf,
  lookup,
  runsOf,
  sliced,
  sizeOf,
  valuesOf,
  type LocatedRun,
  type Mark,
  type Point,
  type Rope,
  type Source,
  type Writer,
} from './marks.js';
import { Overwrites, prepareLinks, removalsOf, writersOf, type EditLink } from './provenance.js';

export type MarkedLine = {
  readonly kind: 'added' | 'removed';
  readonly at: number;
  readonly text: string;
  readonly mark: Mark;
  readonly unit: number;
  readonly follows?: number;
  readonly removal?: Removal;
};
export type Region = Change & { readonly lines: readonly MarkedLine[] };
export type Counts = { readonly added: number; readonly removed: number };
export type Hand = Counts & { readonly holder: string };
export type Proven = {
  readonly verdict: 'proven';
  readonly lines: readonly MarkedLine[] | 'unweighed';
  readonly counts: Counts | 'unweighed';
  readonly regions: readonly Region[];
  readonly hands: readonly Hand[];
  readonly nobody: Counts;
  readonly unheld: boolean;
  readonly standing: ReadonlySet<string>;
  readonly overwritten: ReadonlyMap<string, readonly string[]>;
  readonly existence: Mark | null;
  readonly links: readonly EditLink[];
};
export type Verdict = Proven | ({ readonly verdict: 'unknown'; readonly writers: readonly Writer[] } & Unknown);
export type BaseAlignment = {
  readonly from: string | null;
  readonly to: string | null;
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
  readonly normalized: boolean;
  readonly aligned: Aligned;
};
type BaseSide = { readonly blob: string | null; readonly digest: string | null; readonly shared?: TextSlice };
export type BaseWork = { readonly before: BaseSide; readonly after: BaseSide; readonly normalized: boolean };
const emptyText = shareText('', [0]);
const baseSide = (side: TextContent): BaseSide => ({
  blob: side.blob,
  digest: side.digest,
  shared: side.kind === 'text' ? side.shared : emptyText,
});

export function alignBase(work: BaseWork, budget: Deadline): BaseAlignment {
  return {
    from: work.before.blob,
    to: work.after.blob,
    beforeDigest: work.before.digest,
    afterDigest: work.after.digest,
    normalized: work.normalized,
    aligned:
      work.before.digest === work.after.digest
        ? { changes: [] }
        : alignWindow(
            {
              before: sliceLines(work.before.shared ?? emptyText),
              after: sliceLines(work.after.shared ?? emptyText),
              normalized: work.normalized,
            },
            budget,
          ),
  };
}

const headSource = (head: TextContent): Source => ({
  ...(head.kind === 'text' ? head : bufferOf([])),
  serial: -1,
  mark: 'base',
  origins: null,
  removed: null,
  displaced: [],
  inherited: [],
  left: null,
  right: null,
});

const snapshotOf = (state: FoldState, digest: string | null): Snapshot | undefined => {
  const snapshot = lookup(state.snapshots, digestKey(digest));
  return digest === state.base.digest &&
    snapshot !== undefined &&
    typeof snapshot.transition !== 'string' &&
    lookup(state.snapshot.byRow, snapshot.transition.row) === undefined
    ? state.initial
    : snapshot;
};

function headRoot(state: FoldState, head: TextContent, alignment: BaseAlignment): Rope {
  const base = snapshotOf(state, state.base.digest)?.root ?? null;
  const source = headSource(head);
  if ('reason' in alignment.aligned) return null;
  let root: Rope = null;
  let from = 0;
  for (const change of alignment.aligned.changes) {
    root = joined(root, sliced(base, from, change.before.start - from));
    root = joined(root, leaf({ source, offset: change.after.start, count: change.after.end - change.after.start }));
    from = change.before.end;
  }
  return joined(root, sliced(base, from, sizeOf(base) - from));
}

function holesOf(aligned: Rope, working: Frame, head: TextContent): (at: number, count: number) => Rope {
  const frame = frameOf(aligned);
  const source = headSource(head);
  return (at, count) => {
    let part: Rope = null;
    for (let line = at; line < at + count; line += 1) {
      const point = pointIn(frame, line);
      part = joined(part, leaf(indexOf(working, point) === undefined ? { ...point, count: 1 } : { source, offset: line, count: 1 }));
    }
    return part;
  };
}

type Pairing = { readonly before: ReadonlyMap<number, number>; readonly after: ReadonlyMap<number, number> };
type Displaced = { readonly older: number; readonly newer: number } | { readonly written: number } | { readonly removed: number };

const pairingOf = (matches: readonly Match[]): Pairing => ({
  before: new Map(matches.map((match) => [match.before, match.after])),
  after: new Map(matches.map((match) => [match.after, match.before])),
});

function displacedTo(
  pairing: Pairing,
  head: Frame,
  work: Frame,
  kind: MarkedLine['kind'],
  at: number,
  other: number,
  budget: Deadline,
): Displaced | Unknown {
  if (kind === 'added')
    for (let older = other; ;) {
      if (budget.expired(1)) return { reason: 'budget' };
      const newer = pairing.before.get(older);
      if (newer === undefined) return { older, newer: at };
      const next = indexOf(head, pointIn(work, newer));
      if (next === undefined) return { written: newer };
      older = next;
    }
  for (let newer = other; ;) {
    if (budget.expired(1)) return { reason: 'budget' };
    const older = pairing.after.get(newer);
    if (older === undefined) return { older: at, newer };
    const next = indexOf(work, pointIn(head, older));
    if (next === undefined) return { removed: older };
    newer = next;
  }
}

function transferredBy(
  matches: readonly Match[],
  head: Frame,
  work: Frame,
  removals: RemovalIndex,
  before: number,
  after: number,
): Source | 'external' {
  let latest: Source | undefined;
  const note = (source: Source | undefined): void => {
    if (source !== undefined && source.mark !== 'base' && (latest === undefined || source.serial > latest.serial)) latest = source;
  };
  for (const pair of matches) {
    if (pair.before === before && pair.after === after) continue;
    if (!((pair.before <= before && pair.after >= after) || (pair.before >= before && pair.after <= after))) continue;
    const onHead = pointIn(head, pair.before);
    note(onHead.source);
    note(pointIn(work, pair.after).source);
    if (indexOf(work, onHead) === undefined) note(removals.writer(onHead));
  }
  return latest === undefined || latest.mark === 'base' ? 'external' : latest;
}

function relevantTo(source: Source, work: Frame, gap: Change): boolean {
  const placed = work.positions.get(source);
  const left = source.left === null ? -1 : indexOf(work, source.left);
  const right = source.right === null ? work.count : indexOf(work, source.right);
  return (
    placed?.some((run) => run.at >= gap.after.start && run.at + run.count <= gap.after.end) === true ||
    (source.lines.length === 0 && left !== undefined && right !== undefined && left + 1 >= gap.after.start && right <= gap.after.end)
  );
}

function removalWitnesses(state: FoldState, work: Frame, gap: Change, budget: Deadline): Map<string, Source | 'external'> | Unknown {
  const found = new Map<string, Source | 'external'>();
  for (const source of [...valuesOf(state.snapshot.live)].sort((a, b) => b.serial - a.serial)) {
    if (!relevantTo(source, work, gap)) continue;
    const pending = [source];
    const seen = new Set<Source>();
    while (pending.length > 0) {
      const ancestor = pending.pop() as Source;
      if (seen.has(ancestor)) continue;
      seen.add(ancestor);
      for (const run of runsOf(ancestor.removed)) {
        if (budget.expired(run.count)) return { reason: 'budget' };
        for (let at = run.offset; at < run.offset + run.count; at += 1) {
          const key = keyOf(run.source.lines[at] as string, state.normalized);
          if (!found.has(key)) found.set(key, source.mark === 'base' ? 'external' : source);
        }
      }
      pending.push(...ancestor.inherited);
    }
  }
  return found;
}

function witnessOf(state: FoldState, work: Frame, gap: Change, text: string, budget: Deadline): Source | 'external' | Unknown {
  for (const source of [...valuesOf(state.snapshot.live)].sort((a, b) => b.serial - a.serial)) {
    if (!relevantTo(source, work, gap)) continue;
    const pending = [source];
    const seen = new Set<Source>();
    while (pending.length > 0) {
      const ancestor = pending.pop() as Source;
      if (seen.has(ancestor)) continue;
      seen.add(ancestor);
      for (const run of runsOf(ancestor.removed)) {
        if (budget.expired(run.count)) return { reason: 'budget' };
        for (let at = run.offset; at < run.offset + run.count; at += 1)
          if (keyOf(run.source.lines[at] as string, state.normalized) === keyOf(text, state.normalized))
            return source.mark === 'base' ? 'external' : source;
      }
      pending.push(...ancestor.inherited);
    }
  }
  return 'external';
}

function settledRows(head: Frame, work: Frame, windows: readonly NetWindow[]): ReadonlySet<string> {
  const settled = new Set<string>();
  for (const source of head.positions.keys()) if (typeof source.mark !== 'string') settled.add(source.mark.row);
  const matches = windows.flatMap((window) =>
    matchedRuns(
      window.changes.map((change) => ({
        before: { start: change.before.start - window.gap.before.start, end: change.before.end - window.gap.before.start },
        after: { start: change.after.start - window.gap.after.start, end: change.after.end - window.gap.after.start },
      })),
      window.gap.before.end - window.gap.before.start,
      window.gap.after.end - window.gap.after.start,
    ).map((match) => ({ start: match.after.start + window.gap.after.start, end: match.after.end + window.gap.after.start })),
  );
  let cursor = 0;
  for (const run of work.runs) {
    while (cursor < matches.length && (matches[cursor]?.end ?? 0) <= run.at) cursor += 1;
    const match = matches[cursor];
    if (typeof run.source.mark !== 'string' && match !== undefined && run.at + run.count > match.start) settled.add(run.source.mark.row);
  }
  return settled;
}

export function summarize(
  lines: readonly MarkedLine[],
  regions: readonly Region[],
  existence: Mark | null,
  overwritten: ReadonlyMap<string, readonly string[]>,
  present: readonly Mark[] = [],
): Proven {
  const hands = new Map<string, { holder: string; added: number; removed: number }>();
  const nobody = { added: 0, removed: 0 };
  const counts = { added: 0, removed: 0 };
  const standing = new Set<string>();
  const note = (mark: Mark): { added: number; removed: number } => {
    if (mark === 'external') return nobody;
    standing.add(mark.row);
    let hand = hands.get(mark.holder);
    if (hand === undefined) {
      hand = { holder: mark.holder, added: 0, removed: 0 };
      hands.set(mark.holder, hand);
    }
    return hand;
  };
  for (const line of lines) {
    counts[line.kind] += 1;
    note(line.mark)[line.kind] += 1;
  }
  for (const mark of present) note(mark);
  if (existence !== null) note(existence);
  const unheld = nobody.added + nobody.removed > 0 || existence === 'external' || present.includes('external');
  return {
    verdict: 'proven',
    lines,
    counts,
    regions,
    hands: [...hands.values()],
    nobody,
    unheld,
    standing,
    overwritten,
    existence,
    links: [],
  };
}

const NONE: ReadonlySet<string> = new Set();

const forgotten = (source: Source, ended: ReadonlySet<string>): boolean => typeof source.mark !== 'string' && ended.has(source.mark.row);

const marked = (source: Source, ended: ReadonlySet<string>): Pick<MarkedLine, 'mark' | 'unit'> =>
  source.mark === 'base' || forgotten(source, ended) ? { mark: 'external', unit: -1 } : { mark: source.mark, unit: source.serial };

const holderOf = (mark: Mark): string | null => (mark === 'external' ? null : mark.holder);

type Cancelled = { readonly match: Match; readonly remover: Source | undefined };

function cancelledOf(windows: readonly NetWindow[], head: Frame, work: Frame, removals: RemovalIndex): readonly Cancelled[] {
  const cancelled: Cancelled[] = [];
  for (const window of windows)
    for (const match of window.matches) {
      const gone = pointIn(head, match.before);
      if (indexOf(head, pointIn(work, match.after)) !== undefined || indexOf(work, gone) !== undefined) continue;
      cancelled.push({ match, remover: removals.writer(gone) });
    }
  return cancelled;
}

function anchoring(head: Frame): (point: Point) => number {
  const gaps = new Map<Source, Map<number, number>>();
  const preceding = (point: Point): number | undefined => {
    const runs = head.positions.get(point.source);
    if (runs === undefined) return undefined;
    let low = 0;
    let high = runs.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((runs[mid] as LocatedRun).offset <= point.offset) low = mid + 1;
      else high = mid;
    }
    const run = runs[low - 1];
    if (run !== undefined && point.offset < run.offset + run.count) return run.at + point.offset - run.offset;
    let known = gaps.get(point.source);
    if (known === undefined) gaps.set(point.source, (known = new Map()));
    const found = known.get(low);
    if (found !== undefined) return found;
    const next = runs[low]?.at ?? head.count;
    let at = run === undefined ? endOf(point.source) : run.at + run.count - 1;
    while (at + 1 < next && pointIn(head, at + 1).source.serial === -1) at += 1;
    known.set(low, at);
    return at;
  };
  const ends = new Map<Source, number>();
  const endOf = (source: Source): number => {
    const known = ends.get(source);
    if (known !== undefined) return known;
    let end = source.left === null ? -1 : place(source.left);
    for (const run of runsOf(source.removed)) end = Math.max(end, place({ source: run.source, offset: run.offset + run.count - 1 }));
    ends.set(source, end);
    return end;
  };
  const place = (point: Point): number => preceding(point) ?? endOf(point.source);
  return place;
}

function sliceRegions(
  anchors: readonly Change[],
  cancelled: readonly Cancelled[],
  head: Frame,
  work: Frame,
  removals: RemovalIndex,
  removed: Removals,
  lines: readonly MarkedLine[],
  before: readonly string[],
  after: readonly string[],
  ended: ReadonlySet<string>,
  budget: Deadline,
): readonly Region[] | Unknown {
  const removedAt = new Map<number, MarkedLine>();
  const addedAt = new Map<number, MarkedLine>();
  for (const line of lines) (line.kind === 'removed' ? removedAt : addedAt).set(line.at - 1, line);
  const kept = cancelled.filter((one) => one.remover === undefined).map((one) => one.match);
  const follows = anchoring(head);
  const regions: Region[] = [];
  let next = 0;
  for (const gap of gapsOf(anchors, head.count, work.count)) {
    if (budget.expired(1 + gap.before.end - gap.before.start + gap.after.end - gap.after.start)) return { reason: 'budget' };
    while (next < kept.length && kept[next]!.before < gap.before.start) next += 1;
    const inside: Match[] = [];
    for (; next < kept.length && kept[next]!.before < gap.before.end; next += 1) {
      const match = kept[next]!;
      if (match.after >= gap.after.start && match.after < gap.after.end && match.after >= (inside.at(-1)?.after ?? -1) + 1)
        inside.push(match);
    }
    let from = gap.before.start;
    let to = gap.after.start;
    for (const end of [...inside, { before: gap.before.end, after: gap.after.end }]) {
      if (from < end.before || to < end.after) {
        const region: MarkedLine[] = [];
        for (let at = from; at < end.before; at += 1) {
          const point = pointIn(head, at);
          const remover = removals.writer(point);
          const line = removedAt.get(at) ?? {
            kind: 'removed',
            at: at + 1,
            text: before[at] as string,
            ...(remover === undefined ? { mark: 'external' as const, unit: -1 } : marked(remover, ended)),
          };
          region.push({ ...line, removal: remover === undefined ? undefined : removalAt(removed, remover, point) });
        }
        for (let at = to; at < end.after; at += 1) {
          const point = pointIn(work, at);
          const line = addedAt.get(at) ?? { kind: 'added', at: at + 1, text: after[at] as string, ...marked(point.source, ended) };
          region.push({ ...line, follows: follows(point) });
        }
        regions.push({ before: { start: from, end: end.before }, after: { start: to, end: end.after }, lines: region });
      }
      from = end.before + 1;
      to = end.after + 1;
    }
  }
  return regions;
}

export type Projected = { readonly result: Verdict; readonly alignment: BaseAlignment | null };

export function projectFold(state: FoldState, head: Content, working: Content, budget: Deadline, alignment?: BaseAlignment): Verdict {
  return completeFold(projectWork(state, head, working, budget, alignment), budget).result;
}

export type FormedLine = { readonly formed: string; readonly from: readonly string[] };

type Placed = { owner: Source | 'base' | null; count: number; readonly ats: number[] };

export function* projectWork(
  state: FoldState,
  head: Content,
  working: Content,
  budget: Deadline,
  alignment?: BaseAlignment,
  formed: readonly FormedLine[] = [],
  landed: readonly Landed[] = [],
  ended: ReadonlySet<string> = NONE,
): FoldWork<Projected> {
  let used: BaseAlignment | null = null;
  const done = (result: Verdict): Projected => ({ result, alignment: used });
  const unknown = (reason: Unknown): Projected =>
    done({ verdict: 'unknown', ...reason, writers: writersOf(state).filter((writer) => !ended.has(writer.row)) });
  if (head.kind === 'unread') return unknown({ reason: 'unread', side: 'head', cause: head.cause });
  if (working.kind === 'unread') return unknown({ reason: 'unread', side: 'working', cause: working.cause });
  if ((head.kind !== 'text' && head.kind !== 'absent') || (working.kind !== 'text' && working.kind !== 'absent'))
    return unknown({ reason: 'opaque', cause: 'The projected text does not match the recorded line layout', side: 'projection' });
  if (
    alignment !== undefined &&
    (alignment.from !== state.base.blob ||
      alignment.to !== head.blob ||
      alignment.beforeDigest !== state.base.digest ||
      alignment.afterDigest !== head.digest ||
      alignment.normalized !== state.normalized)
  )
    return unknown({ reason: 'alignment' });
  used = alignment ?? null;
  if (head.digest === working.digest) return done(summarize([], [], null, new Map()));
  const before = contentLines(head);
  const after = contentLines(working);
  const newer = frameOf(state.snapshot.root);
  const recalled = snapshotOf(state, head.digest);
  const removedOf = rowRemovals(state);
  const composed = recalled === undefined ? landedRoot(state, head, landed, removedOf) : undefined;
  let root: Rope;
  let traced = true;
  if (recalled !== undefined) root = recalled.root;
  else if (composed !== undefined && composed !== 'unfilled') root = composed.root;
  else {
    const baseRequest: BaseWork = { before: baseSide(state.base), after: baseSide(head), normalized: state.normalized };
    const base =
      alignment ??
      (state.base.digest === head.digest ? alignBase(baseRequest, budget) : yield* askFold({ kind: 'base', work: baseRequest }));
    if ('reason' in base.aligned) return unknown(base.aligned);
    used = base;
    const aligned = headRoot(state, head, base);
    const filled = composed === 'unfilled' ? landedRoot(state, head, landed, removedOf, holesOf(aligned, newer, head)) : undefined;
    root = filled === undefined || filled === 'unfilled' ? aligned : filled.root;
    traced = false;
  }
  const older = frameOf(root);
  if (newer.count !== after.length)
    return unknown({ reason: 'opaque', cause: 'The projected text does not match the recorded line layout', side: 'projection' });
  const anchors = anchorsOf(older, newer);
  const windows = yield* askFold({
    kind: 'net',
    work: {
      head: walkFrame(older),
      work: walkFrame(newer),
      before: head.kind === 'text' ? head.shared : emptyText,
      after: working.kind === 'text' ? working.shared : emptyText,
      anchors,
      normalized: state.normalized,
    },
  });
  if ('reason' in windows) return unknown(windows);
  const removals = removalsOf(state, older, budget);
  if ('reason' in removals) return unknown(removals);
  const formedFrom = new Map<string, (readonly string[])[]>();
  for (const line of formed) {
    const key = keyOf(line.formed, state.normalized);
    formedFrom.set(key, [...(formedFrom.get(key) ?? []), line.from]);
  }
  const regions: Region[] = [];
  const lines: MarkedLine[] = [];
  const joint: EditLink[] = [];
  for (const window of windows) {
    let removedBy: ReadonlyMap<string, Source | 'external'> | undefined;
    let pairing: Pairing | undefined;
    for (const change of window.changes) {
      const placed = new Map<string, Placed>();
      const sources = new Map<readonly string[], Source | 'external'>();
      const residue = new Map<number, Source>();
      const holding = new Set<Source>();
      if (formedFrom.size > 0)
        for (let at = change.after.start; at < change.after.end; at += 1) {
          const point = pointIn(newer, at).source;
          const owner = point.mark === 'base' ? 'base' : typeof point.mark === 'string' ? null : point;
          if (owner !== null && owner !== 'base') holding.add(owner);
          const key = keyOf(after[at] as string, state.normalized);
          const known = placed.get(key);
          if (known === undefined) placed.set(key, { owner, count: 1, ats: [at] });
          else {
            if (known.owner !== owner) known.owner = null;
            known.count += 1;
            known.ats.push(at);
          }
        }
      const formedBy = (text: string): Source | 'external' | Unknown => {
        for (const from of formedFrom.get(keyOf(text, state.normalized)) ?? []) {
          let source = sources.get(from);
          if (source === undefined) {
            if (removedBy === undefined) {
              const index = removalWitnesses(state, newer, window.gap, budget);
              if ('reason' in index) return index;
              removedBy = index;
            }
            const wanted = new Map<string, number>();
            for (const line of from) {
              const key = keyOf(line, state.normalized);
              wanted.set(key, (wanted.get(key) ?? 0) + 1);
            }
            const writers = new Set<Source>();
            const unformed: number[] = [];
            let whole = true;
            for (const [key, count] of wanted) {
              const here = placed.get(key);
              if (here !== undefined && here.owner !== null && here.count === count) {
                if (here.owner === 'base') unformed.push(...here.ats);
                else writers.add(here.owner);
                continue;
              }
              const by = removedBy.get(key);
              if (by === undefined || by === 'external') {
                whole = false;
                break;
              }
              writers.add(by);
            }
            const unseen = [...writers].filter((writer) => !holding.has(writer));
            const marked =
              !whole || unseen.length > 1 ? undefined : (unseen[0] ?? [...writers].sort((one, two) => two.serial - one.serial)[0]);
            source = marked ?? 'external';
            sources.set(from, source);
            if (marked !== undefined) {
              for (const at of unformed) residue.set(at, marked);
              for (const other of writers)
                if (other !== marked) joint.push({ from: marked.serial, to: other.serial }, { from: other.serial, to: marked.serial });
            }
          }
          if (source !== 'external') return source;
        }
        return 'external';
      };
      const changed: MarkedLine[] = [];
      for (const kind of ['removed', 'added'] as const) {
        const range = kind === 'removed' ? change.before : change.after;
        for (let at = range.start; at < range.end; at += 1) {
          const point = pointIn(kind === 'removed' ? older : newer, at);
          const other = indexOf(kind === 'removed' ? newer : older, point);
          const text = (kind === 'removed' ? before : after)[at] as string;
          let writer: Source | 'external';
          if (other !== undefined) {
            pairing ??= pairingOf(window.matches);
            const end = displacedTo(pairing, older, newer, kind, at, other, budget);
            if ('reason' in end) return unknown(end);
            if ('written' in end) {
              const source = pointIn(newer, end.written).source;
              writer = source.mark === 'base' ? 'external' : source;
            } else if ('removed' in end) {
              const removing = removals.writer(pointIn(older, end.removed));
              const witnessed = removing ?? witnessOf(state, newer, window.gap, before[end.removed] as string, budget);
              if (typeof witnessed !== 'string' && 'reason' in witnessed) return unknown(witnessed);
              writer = witnessed;
            } else {
              if (budget.expired(window.matches.length)) return unknown({ reason: 'budget' });
              writer = transferredBy(window.matches, older, newer, removals, end.older, end.newer);
            }
          } else if (kind === 'added') writer = point.source.mark === 'base' ? (residue.get(at) ?? 'external') : point.source;
          else {
            const removing = removals.writer(point);
            const witnessed = removing === undefined ? witnessOf(state, newer, window.gap, text, budget) : removing;
            const found = witnessed === 'external' ? formedBy(text) : witnessed;
            if (typeof found !== 'string' && 'reason' in found) return unknown(found);
            writer = found;
          }
          const borne = writer === 'external' || forgotten(writer, ended) ? null : writer;
          const mark = borne === null || borne.mark === 'base' ? 'external' : borne.mark;
          changed.push({ kind, at: at + 1, text, mark, unit: borne === null ? -1 : borne.serial });
        }
      }
      regions.push({ ...change, lines: changed });
      lines.push(...changed);
    }
  }
  if (budget.expired(windows.reduce((sum, window) => sum + window.matches.length, 0))) return unknown({ reason: 'budget' });
  const cancelled = cancelledOf(windows, older, newer, removals);
  const present: Mark[] = [];
  if (traced)
    for (const { match, remover } of cancelled) {
      const added = marked(pointIn(newer, match.after).source, ended).mark;
      const removed = remover === undefined ? undefined : marked(remover, ended).mark;
      if (removed !== undefined && holderOf(added) !== holderOf(removed)) present.push(removed, added);
    }
  const slices = sliceRegions(anchors, cancelled, older, newer, removals, removedOf, lines, before, after, ended, budget);
  if ('reason' in slices) return unknown(slices);
  const existence =
    lines.length > 0 || (head.kind === 'absent') === (working.kind === 'absent')
      ? null
      : state.snapshot.existence === 'base' || (state.snapshot.existence !== 'external' && ended.has(state.snapshot.existence.row))
        ? 'external'
        : state.snapshot.existence;
  const result = summarize(lines, slices, existence, new Map(), present);
  const groups = result.hands.length + (result.nobody.added + result.nobody.removed > 0 ? 1 : 0);
  const linking = groups < 2 ? null : prepareLinks(state, older, head.kind === 'absent', regions, budget);
  if (linking !== null && 'reason' in linking) return unknown(linking);
  const links = linking === null ? [] : yield* askFold({ kind: 'links', work: linking });
  if ('reason' in links) return unknown(links);
  const all = joint.length === 0 ? links : [...links, ...joint];
  const gone =
    ended.size === 0
      ? null
      : new Set([...valuesOf(state.snapshot.edits)].flatMap((source) => (forgotten(source, ended) ? [source.serial] : [])));
  return done({
    ...result,
    links: gone === null ? all : all.filter((link) => !gone.has(link.from) && !gone.has(link.to)),
    overwritten: new Overwrites(
      state.snapshot.consumers,
      state.snapshot.active,
      state.records,
      result.standing,
      settledRows(older, newer, windows),
    ),
  });
}
