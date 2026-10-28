import { bytesDigest, contentDigest, contentOf as decodedOf, withBom } from '@runlith/files/content';
import type { LineHunk } from '@runlith/files/hunk';
import type { Change, Deadline } from '@runlith/utils/sequenceDiff';
import { alignWindow, anchorWindows } from './alignment.js';
import { askFold, completeFold, type FoldWork } from './jobs.js';
import { lineView, sliceLines, sliceText, type TextSlice } from './text.js';
import {
  bufferOf,
  sharedRuns,
  withBytes,
  joined,
  keyOf,
  leaf,
  lineCount,
  lookup,
  put,
  remove,
  valuesOf,
  pointAt,
  runsOf,
  positionOf,
  sourceSpans,
  sizeOf,
  sliced,
  spliced,
  textOf,
  tokensOf,
  type KeyTree,
  type Mark,
  type Rope,
  type Source,
  type TextLines,
} from './marks.js';

export type TextContent =
  | (TextLines & { readonly kind: 'text'; readonly digest: string; readonly blob: string })
  | { readonly kind: 'absent'; readonly digest: null; readonly blob: null };
export type Content =
  | TextContent
  | { readonly kind: 'whole'; readonly digest: string }
  | { readonly kind: 'opaque'; readonly digest: string | null }
  | { readonly kind: 'unread'; readonly cause: string };
export type FoldRow = {
  readonly id: string;
  readonly holder: string;
  readonly before: Content;
  readonly after: Content;
  readonly hunk?: LineHunk;
  readonly reverts?: readonly string[];
};
export type Unknown =
  | { readonly reason: 'budget' | 'alignment' }
  | {
      readonly reason: 'opaque';
      readonly cause: string;
      readonly side?: 'base' | 'head' | 'working' | 'before' | 'after' | 'projection';
      readonly row?: string;
    }
  | { readonly reason: 'sequence'; readonly expected: string | null; readonly received: string | null }
  | { readonly reason: 'unread'; readonly side: 'base' | 'head' | 'working' | 'before' | 'after'; readonly cause: string };
export type Splice = {
  readonly start: number;
  readonly count: number;
  readonly lines: readonly string[];
  readonly before: readonly string[];
};
export type Step = {
  readonly before: string | null;
  readonly after: string | null;
  readonly mark: Mark;
  readonly splices: readonly Splice[];
};
export type Consumer = { readonly serial: number; readonly mark: Mark; readonly previous: Consumer | null };
export type Snapshot = {
  readonly digest: string | null;
  readonly transition: Mark | 'base';
  readonly root: Rope;
  readonly edits: KeyTree<Source>;
  readonly live: KeyTree<Source>;
  readonly counts: KeyTree<number>;
  readonly byRow: KeyTree<readonly Source[]>;
  readonly consumers: KeyTree<Consumer>;
  readonly active: KeyTree<boolean>;
  readonly existence: Mark | 'base';
};
export type RowLink = { readonly row: FoldRow; readonly previous: RowLink | null };
export type FoldState = {
  readonly base: TextContent;
  readonly normalized: boolean;
  readonly initial: Snapshot;
  readonly snapshot: Snapshot;
  readonly snapshots: KeyTree<Snapshot>;
  readonly rows: RowLink | null;
  readonly records: KeyTree<string | null>;
  readonly last: string | null;
  readonly serial: number;
  readonly bytes: number;
};
export type CachedFold =
  | { readonly kind: 'complete'; readonly state: FoldState }
  | { readonly kind: 'after'; readonly state: FoldState; readonly row: string | null };

export type PreparedText = { readonly digest: string; readonly shared: TextSlice };
export type PreparedBytes =
  | (PreparedText & { readonly kind: 'text'; readonly text: string })
  | { readonly kind: 'whole'; readonly digest: string };
export function prepareText(text: string, digest = contentDigest(text)): PreparedText {
  return { digest, shared: bufferOf(tokensOf(text), text).shared };
}
export function prepareBytes(bytes: Uint8Array): PreparedBytes {
  const digest = bytesDigest(bytes);
  const held = decodedOf(bytes);
  if (held.kind !== 'text') return { kind: 'whole', digest };
  const text = withBom(held);
  return { kind: 'text', text, ...prepareText(text, digest) };
}
export function contentFrom(text: string, prepared: PreparedText, blob?: string): TextContent {
  return {
    kind: 'text',
    text,
    digest: prepared.digest,
    blob: blob ?? prepared.digest,
    shared: prepared.shared,
    offsets: prepared.shared.offsets,
    lines: lineView(text, prepared.shared.offsets),
  };
}

export function contentOf(text: string | null, blob?: string, known?: string): TextContent {
  if (text === null) return { kind: 'absent', digest: null, blob: null };
  const digest = known ?? contentDigest(text);
  return { kind: 'text', digest, blob: blob ?? digest, ...bufferOf(tokensOf(text), text) };
}
export const contentText = (side: Content): string | null | undefined =>
  side.kind === 'text' ? side.text : side.kind === 'absent' ? null : undefined;
export const contentLines = (side: TextContent): readonly string[] => (side.kind === 'text' ? side.lines : []);
export const digestKey = (digest: string | null): string => (digest === null ? 'absent' : `bytes:${digest}`);
export const digestOf = (side: Content): string | null | undefined => (side.kind === 'unread' ? undefined : side.digest);

export function startFold(base: Content, normalized: boolean): FoldState | Unknown {
  if (base.kind === 'unread') return { reason: 'unread', side: 'base', cause: base.cause };
  if (base.kind !== 'text' && base.kind !== 'absent')
    return { reason: 'opaque', cause: `The base text for digest ${base.digest} was not retained`, side: 'base' };
  const source: Source = {
    ...(base.kind === 'text' ? base : bufferOf([])),
    serial: 0,
    mark: 'base',
    removed: null,
    origins: null,
    displaced: [],
    inherited: [],
    left: null,
    right: null,
  };
  const snapshot: Snapshot = {
    digest: base.digest,
    transition: 'base',
    root: leaf({ source, offset: 0, count: source.lines.length }),
    edits: null,
    live: null,
    counts: null,
    byRow: null,
    consumers: null,
    active: null,
    existence: 'base',
  };
  return {
    base,
    normalized,
    initial: snapshot,
    snapshot,
    snapshots: put(null, digestKey(base.digest), snapshot),
    rows: null,
    records: null,
    last: null,
    serial: 0,
    bytes: 512 + source.text.length * 6 + source.lines.length * 64,
  };
}

function originsOf(root: Rope, exhausted: ReadonlySet<Source>): Rope {
  let origins: Rope = null;
  for (const run of runsOf(root))
    origins = joined(origins, run.source.mark === 'base' ? leaf(run) : exhausted.has(run.source) ? run.source.origins : null);
  return origins;
}

function references(snapshot: Snapshot, removed: Rope, added: Rope): Snapshot {
  let { counts, live } = snapshot;
  const changed = new Map<Source, number>();
  for (const run of runsOf(removed)) changed.set(run.source, (changed.get(run.source) ?? 0) - run.count);
  for (const run of runsOf(added)) changed.set(run.source, (changed.get(run.source) ?? 0) + run.count);
  for (const [source, delta] of changed) {
    if (source.mark === 'base') continue;
    const key = String(source.serial);
    const count = (lookup(counts, key) ?? 0) + delta;
    counts = count === 0 ? remove(counts, key) : put(counts, key, count);
    live = count === 0 ? remove(live, key) : put(live, key, source);
  }
  return { ...snapshot, counts, live };
}

const recallOf = (state: FoldState, digest: string | null, mark: Mark): Snapshot | undefined => {
  const snapshot = lookup(state.snapshots, digestKey(digest));
  return snapshot !== undefined && (typeof mark === 'string' || typeof snapshot.transition !== 'string') ? snapshot : undefined;
};

export function applyStep(state: FoldState, step: Step): FoldState | Unknown {
  if (state.snapshot.digest !== step.before) return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  const recalled = recallOf(state, step.after, step.mark);
  if (recalled !== undefined) return { ...state, snapshot: recalled };
  const removedCounts = new Map<Source, number>();
  for (const splice of step.splices)
    for (const run of runsOf(sliced(state.snapshot.root, splice.start, splice.count)))
      removedCounts.set(run.source, (removedCounts.get(run.source) ?? 0) + run.count);
  const exhausted = new Set(
    [...removedCounts]
      .filter(([source, count]) => source.mark !== 'base' && count === lookup(state.snapshot.counts, String(source.serial)))
      .map(([source]) => source),
  );
  const changingExistence = (step.before === null) !== (step.after === null);
  const displaced = changingExistence ? [...valuesOf(state.snapshot.live)] : [];
  const splices = step.splices.length === 0 && changingExistence ? [{ start: 0, count: 0, lines: [], before: [] }] : step.splices;
  let snapshot = state.snapshot;
  let serial = state.serial;
  let bytes = state.bytes;
  const written: Source[] = [];
  for (let at = splices.length - 1; at >= 0; at -= 1) {
    const splice = splices[at] as Splice;
    if (splice.start < 0 || splice.count < 0 || splice.start + splice.count > sizeOf(snapshot.root))
      return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
    if (splice.before.length !== splice.count) return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
    const removed = withBytes(sliced(snapshot.root, splice.start, splice.count), splice.before);
    let origins = originsOf(removed, exhausted);
    if (at === 0) for (const source of displaced) origins = joined(origins, source.origins);
    const parents = [...new Set([...runsOf(removed)].map((run) => run.source).concat(at === 0 ? displaced : []))];
    const source: Source = {
      ...bufferOf(splice.lines),
      serial: ++serial,
      mark: step.mark,
      removed,
      origins,
      displaced: parents,
      inherited: parents.filter((parent) => exhausted.has(parent) || displaced.includes(parent)),
      left: pointAt(snapshot.root, splice.start - 1),
      right: pointAt(snapshot.root, splice.start + splice.count),
    };
    const added = leaf({ source, offset: 0, count: source.lines.length });
    snapshot = references(snapshot, removed, added);
    const root = spliced(snapshot.root, splice.start, splice.count, added);
    let consumers = snapshot.consumers;
    for (const parent of parents)
      if (typeof parent.mark !== 'string')
        consumers = put(consumers, parent.mark.row, {
          serial: source.serial,
          mark: step.mark,
          previous: lookup(consumers, parent.mark.row) ?? null,
        });
    snapshot = {
      ...snapshot,
      root,
      consumers,
      edits: put(snapshot.edits, String(source.serial), source),
      active: put(snapshot.active, String(source.serial), true),
    };
    written.push(source);
    bytes +=
      512 +
      512 * (root?.height ?? 1) +
      source.text.length * 6 +
      source.lines.length * 64 +
      splice.before.reduce((sum, line) => sum + 64 + line.length * 2, 0);
  }
  let live = snapshot.live;
  for (const source of exhausted) live = remove(live, String(source.serial));
  for (const source of displaced) live = remove(live, String(source.serial));
  for (const source of written)
    if (source.lines.length > 0 || source.origins !== null || source.removed !== null) live = put(live, String(source.serial), source);
  snapshot = {
    ...snapshot,
    digest: step.after,
    transition: step.before === step.after ? snapshot.transition : step.mark,
    live,
    byRow: typeof step.mark === 'string' ? snapshot.byRow : put(snapshot.byRow, step.mark.row, written),
    existence: changingExistence ? step.mark : snapshot.existence,
  };
  return {
    ...state,
    snapshot,
    snapshots: put(state.snapshots, digestKey(step.after), snapshot),
    serial,
    bytes: bytes + 512 + 256 * ((state.snapshots?.height ?? 1) + (snapshot.edits?.height ?? 1)),
  };
}

export type HunkWork = {
  readonly before: string | null;
  readonly after: string | null;
  readonly mark: Mark;
  readonly hunk: LineHunk;
  readonly normalized: boolean;
  readonly frontier: readonly TextSlice[];
};

export function hunkWork(state: FoldState, row: FoldRow): HunkWork | Unknown {
  const hunk = row.hunk;
  if (hunk === undefined || row.after.kind === 'unread' || digestOf(row.before) !== state.snapshot.digest)
    return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  const start = hunk.firstLine - 1 - hunk.windowBefore;
  const count = lineCount(hunk.oldText);
  if (!Number.isInteger(start) || start < 0 || start + count > sizeOf(state.snapshot.root))
    return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  return {
    before: state.snapshot.digest,
    after: row.after.digest,
    mark: { row: row.id, holder: row.holder },
    hunk,
    normalized: state.normalized,
    frontier: sharedRuns(sliced(state.snapshot.root, start, count)),
  };
}
export function prepareHunk(work: HunkWork, budget: Deadline): Step | Unknown {
  const before = tokensOf(work.hunk.oldText);
  const after = tokensOf(work.hunk.newText);
  const frontier = work.frontier.flatMap(sliceLines);
  const start = work.hunk.firstLine - 1 - work.hunk.windowBefore;
  if (
    before.length !== frontier.length ||
    before.some((line, at) => keyOf(line, work.normalized) !== keyOf(frontier[at] as string, work.normalized))
  )
    return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  const aligned = alignWindow({ before, after, normalized: work.normalized }, budget);
  if ('reason' in aligned) return aligned;
  return {
    before: work.before,
    after: work.after,
    mark: work.mark,
    splices: aligned.changes.map((change) => ({
      start: start + change.before.start,
      count: change.before.end - change.before.start,
      before: before.slice(change.before.start, change.before.end),
      lines: after.slice(change.after.start, change.after.end),
    })),
  };
}

export type GapScan = { readonly before: readonly TextSlice[]; readonly after: readonly TextSlice[]; readonly normalized: boolean };
export function scanGaps(work: GapScan, budget: Deadline): readonly Change[] | Unknown {
  const anchored = anchorWindows(
    { before: work.before.flatMap(sliceLines), after: work.after.flatMap(sliceLines), normalized: work.normalized },
    budget,
  );
  return 'reason' in anchored ? anchored : anchored.gaps;
}
export type GapWork = {
  readonly before: string | null;
  readonly after: string | null;
  readonly windows: readonly { readonly start: number; readonly before: readonly TextSlice[]; readonly after: readonly TextSlice[] }[];
  readonly mark: Mark;
  readonly normalized: boolean;
};

export function gapWork(state: FoldState, after: TextContent, mark: Mark, gaps: readonly Change[], before?: TextContent): GapWork {
  return {
    before: state.snapshot.digest,
    after: after.digest,
    mark,
    normalized: state.normalized,
    windows: gaps.map((gap) => ({
      start: gap.before.start,
      before:
        before?.kind === 'text'
          ? [sliceText(before.shared, gap.before.start, gap.before.end)]
          : sharedRuns(sliced(state.snapshot.root, gap.before.start, gap.before.end - gap.before.start)),
      after: after.kind === 'text' ? [sliceText(after.shared, gap.after.start, gap.after.end)] : [],
    })),
  };
}

export function prepareGap(work: GapWork, budget: Deadline): Step | Unknown {
  const splices: Splice[] = [];
  for (const window of work.windows) {
    const before = window.before.flatMap(sliceLines);
    const after = window.after.flatMap(sliceLines);
    const aligned = alignWindow({ before, after, normalized: work.normalized }, budget);
    if ('reason' in aligned) return aligned;
    for (const change of aligned.changes)
      splices.push({
        start: window.start + change.before.start,
        count: change.before.end - change.before.start,
        before: before.slice(change.before.start, change.before.end),
        lines: after.slice(change.after.start, change.after.end),
      });
  }
  return { before: work.before, after: work.after, mark: work.mark, splices };
}

export function prepareStep(
  state: FoldState,
  after: Content,
  mark: Mark,
  budget: Deadline,
  hunk?: LineHunk,
  before?: TextContent,
): Step | Unknown {
  return completeFold(stepWork(state, after, mark, hunk, before), budget);
}

function* stepWork(
  state: FoldState,
  after: Content,
  mark: Mark,
  hunk?: LineHunk,
  before?: TextContent,
  partial = false,
): FoldWork<Step | Unknown> {
  if (after.kind === 'unread') return { reason: 'unread', side: 'after', cause: after.cause };
  if (recallOf(state, after.digest, mark) !== undefined) return { before: state.snapshot.digest, after: after.digest, mark, splices: [] };
  if (hunk !== undefined) {
    const start = hunk.firstLine - 1 - hunk.windowBefore;
    const count = lineCount(hunk.oldText);
    if (Number.isInteger(start) && start >= 0 && start + count <= sizeOf(state.snapshot.root)) {
      const frontier = sharedRuns(sliced(state.snapshot.root, start, count));
      const prepared = yield* askFold({
        kind: 'hunk',
        work: { before: state.snapshot.digest, after: after.digest, mark, hunk, normalized: state.normalized, frontier },
      });
      if (!('reason' in prepared)) return prepared;
      if (prepared.reason !== 'opaque') return prepared;
    }
    if (partial && before === undefined) return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  }
  if (after.kind !== 'text' && after.kind !== 'absent')
    return { reason: 'opaque', cause: `The text for digest ${after.digest} was not retained` };
  if (before !== undefined && before.digest !== state.snapshot.digest)
    return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  const gaps = yield* askFold({
    kind: 'gaps',
    work: {
      before: before?.kind === 'text' ? [before.shared] : sharedRuns(state.snapshot.root),
      after: after.kind === 'text' ? [after.shared] : [],
      normalized: state.normalized,
    },
  });
  return 'reason' in gaps ? gaps : yield* askFold({ kind: 'gap', work: gapWork(state, after, mark, gaps, before) });
}

function remembered(state: FoldState, row: FoldRow): FoldState {
  const retained: FoldRow = {
    id: row.id,
    holder: row.holder,
    before: { kind: 'opaque', digest: digestOf(row.before) ?? null },
    after: { kind: 'opaque', digest: digestOf(row.after) ?? null },
  };
  return {
    ...state,
    rows: { row: retained, previous: state.rows },
    records: put(state.records, row.id, state.last),
    last: row.id,
    bytes: state.bytes + 256 + (row.id.length + row.holder.length) * 2,
  };
}

export function recordStep(state: FoldState, row: FoldRow, step: Step | Unknown, budget: Deadline): FoldState | Unknown {
  if (digestOf(row.before) !== state.snapshot.digest || (!('reason' in step) && step.before !== state.snapshot.digest))
    return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  if ('reason' in step && step.reason !== 'opaque') return step;
  let prepared = step;
  if ('reason' in step) {
    const fallback = prepareStep(
      state,
      row.after,
      { row: row.id, holder: row.holder },
      budget,
      undefined,
      row.before.kind === 'text' || row.before.kind === 'absent' ? row.before : undefined,
    );
    if ('reason' in fallback) return fallback;
    prepared = fallback;
  }
  if ('reason' in prepared) return prepared;
  const applied = applyStep(state, prepared);
  return 'reason' in applied ? applied : remembered(applied, row);
}

export type Restored = {
  readonly state: FoldState;
  readonly text: string | null;
  readonly restored: readonly string[];
  readonly partial: readonly string[];
  readonly blocked: readonly string[];
};
export function restoreFold(state: FoldState, selected: ReadonlySet<string>, budget: Deadline, working?: Content): Restored | Unknown {
  let snapshot = state.snapshot;
  let bytes = state.bytes;
  if (working?.kind === 'unread') return { reason: 'unread', side: 'working', cause: working.cause };
  if (working !== undefined && digestOf(working) !== snapshot.digest)
    return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  if (state.normalized && working?.kind !== 'text' && working?.kind !== 'absent')
    return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
  let raw: Rope | undefined;
  if (working?.kind === 'text') {
    if (working.lines.length !== sizeOf(snapshot.root))
      return { reason: 'opaque', cause: 'The recorded edit does not match its line window' };
    const source: Source = {
      ...working,
      serial: -1,
      mark: 'external',
      removed: null,
      origins: null,
      displaced: [],
      inherited: [],
      left: null,
      right: null,
    };
    raw = leaf({ source, offset: 0, count: source.lines.length });
  }
  const restored = new Set<string>();
  const blocked = new Set<string>();
  const sources = [...selected]
    .flatMap((row) => lookup(snapshot.byRow, row) ?? [])
    .filter((source) => lookup(snapshot.edits, String(source.serial)) !== undefined)
    .sort((a, b) => b.serial - a.serial);
  for (const source of sources) {
    const row = typeof source.mark === 'string' ? '' : source.mark.row;
    const spans = sourceSpans(snapshot.root, source);
    if (budget.expired(spans.length + 1)) return { reason: 'budget' };
    let at: number;
    if (source.lines.length > 0) {
      at = spans[0]?.at ?? -1;
      let count = 0;
      let contiguous = true;
      for (const span of spans) {
        contiguous &&= span.at === at + count && span.run.offset === count;
        count += span.run.count;
      }
      if (!contiguous || count !== source.lines.length) {
        blocked.add(row);
        continue;
      }
    } else {
      const left = source.left === null ? -1 : positionOf(snapshot.root, source.left);
      const right = source.right === null ? sizeOf(snapshot.root) : positionOf(snapshot.root, source.right);
      if (left === undefined || right !== left + 1) {
        blocked.add(row);
        continue;
      }
      at = right;
    }
    const removed = sliced(snapshot.root, at, source.lines.length);
    snapshot = references(snapshot, removed, source.removed);
    snapshot = {
      ...snapshot,
      root: spliced(snapshot.root, at, source.lines.length, source.removed),
      edits: remove(snapshot.edits, String(source.serial)),
      active: remove(snapshot.active, String(source.serial)),
      live: remove(snapshot.live, String(source.serial)),
    };
    if (raw !== undefined) raw = spliced(raw, at, source.lines.length, source.removed);
    bytes += 512 * ((snapshot.root?.height ?? 1) + (snapshot.edits?.height ?? 1));
    restored.add(row);
  }
  const existence = snapshot.existence;
  const undoExistence = typeof existence !== 'string' && selected.has(existence.row) && !blocked.has(existence.row);
  let absent = snapshot.digest === null;
  if (undoExistence) {
    for (let link = state.rows; link !== null; link = link.previous)
      if (link.row.id === existence.row) {
        absent = digestOf(link.row.before) === null;
        break;
      }
    restored.add(existence.row);
  }
  const text = absent && sizeOf(snapshot.root) === 0 ? null : textOf(raw ?? snapshot.root);
  const digest = text === null ? null : contentDigest(text);
  snapshot = lookup(state.snapshots, digestKey(digest)) ?? { ...snapshot, digest, existence: undoExistence ? 'base' : existence };
  const partial = [...restored].filter((row) => blocked.has(row));
  return {
    state: {
      ...state,
      snapshot,
      snapshots: put(state.snapshots, digestKey(digest), snapshot),
      bytes: bytes + 256 + 128 * (state.snapshots?.height ?? 1),
    },
    text,
    restored: [...restored].filter((row) => !blocked.has(row)),
    partial,
    blocked: [...blocked].filter((row) => !restored.has(row)),
  };
}

export function appendRow(state: FoldState, row: FoldRow, budget: Deadline, following?: Content): FoldState | Unknown {
  return completeFold(appendWork(state, row, budget, following), budget);
}
export function* appendWork(
  state: FoldState,
  row: FoldRow,
  budget: Deadline,
  following?: Content,
  partial = false,
): FoldWork<FoldState | Unknown> {
  if (row.before.kind === 'unread') return { reason: 'unread', side: 'before', cause: row.before.cause };
  if (row.after.kind === 'unread') return { reason: 'unread', side: 'after', cause: row.after.cause };
  let frontier = state;
  if (row.before.digest !== state.snapshot.digest) {
    const gap = yield* stepWork(state, row.before, 'external');
    if ('reason' in gap) return gap.reason === 'opaque' ? { ...gap, side: 'before', row: row.id } : gap;
    const aligned = applyStep(state, gap);
    if ('reason' in aligned) return aligned.reason === 'opaque' ? { ...aligned, side: 'before', row: row.id } : aligned;
    frontier = aligned;
  }
  if (row.reverts !== undefined) {
    const undone = restoreFold(frontier, new Set(row.reverts), budget, row.before);
    if ('reason' in undone) {
      if (undone.reason !== 'opaque' || row.after.kind !== 'text')
        return undone.reason === 'opaque' ? { ...undone, side: 'before', row: row.id } : undone;
    } else if (undone.state.snapshot.digest === row.after.digest) return remembered(undone.state, row);
  }
  const after =
    (row.after.kind === 'opaque' || row.after.kind === 'whole') && following !== undefined && digestOf(following) === row.after.digest
      ? following
      : row.after;
  const step = yield* stepWork(
    frontier,
    after,
    { row: row.id, holder: row.holder },
    row.hunk,
    row.before.kind === 'text' || row.before.kind === 'absent' ? row.before : undefined,
    partial,
  );
  const applied = 'reason' in step ? step : recordStep(frontier, row, step, budget);
  return 'reason' in applied && applied.reason === 'opaque' ? { ...applied, side: 'after', row: row.id } : applied;
}

export function workingFold(state: FoldState, working: Content, budget: Deadline): FoldState | Unknown {
  return completeFold(workingWork(state, working), budget);
}
export function* workingWork(state: FoldState, working: Content): FoldWork<FoldState | Unknown> {
  if (working.kind === 'unread') return { reason: 'unread', side: 'working', cause: working.cause };
  if (state.snapshot.digest === working.digest) return state;
  const step = yield* stepWork(state, working, 'external');
  const applied = 'reason' in step ? step : applyStep(state, step);
  return 'reason' in applied && applied.reason === 'opaque' ? { ...applied, side: 'working' } : applied;
}
