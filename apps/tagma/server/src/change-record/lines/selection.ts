import { contentText, type Content } from './folding.js';
import type { LandedPiece, Removal } from './landed.js';
import type { Mark } from './marks.js';
import type { MarkedLine, Verdict } from './projection.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';

const OPERATOR_KEY = holderKey(OPERATOR);

export type Carried = { readonly holders: readonly string[]; readonly external: boolean; readonly unknown: boolean };
export type SelectedSpan = { readonly selected: number; readonly working: number; readonly count: number };
export type Selection =
  | { readonly kind: 'none' }
  | { readonly refuse: 'lines-held'; readonly holders: readonly string[]; readonly nobody?: true }
  | { readonly refuse: 'walk-cut' }
  | { readonly kind: 'whole'; readonly rows: readonly string[]; readonly carried: Carried }
  | {
      readonly kind: 'text';
      readonly text: string | null;
      readonly lines: readonly MarkedLine[];
      readonly positions: readonly SelectedSpan[];
      readonly pieces: readonly LandedPiece[];
      readonly rows: readonly string[];
      readonly carried: Carried;
    };

export type Bearers = { readonly holders: ReadonlySet<string>; readonly nobody: boolean };

export function selectFold(
  verdict: Verdict,
  head: Content,
  working: Content,
  bearers: Bearers,
  retired: ReadonlySet<string>,
  whole = false,
): Selection {
  const carriers = bearers.holders;
  if (verdict.verdict === 'unknown')
    return whole
      ? {
          kind: 'whole',
          rows: verdict.writers.map((writer) => writer.row),
          carried: {
            holders: [...new Set(verdict.writers.filter((writer) => !carriers.has(writer.holder)).map((writer) => writer.holder))],
            external: false,
            unknown: true,
          },
        }
      : { refuse: 'walk-cut' };
  const rows = new Set<string>();
  const holders = new Set<string>();
  let external = false;
  const note = (mark: Mark): void => {
    if (mark === 'external') {
      external = true;
      return;
    }
    rows.add(mark.row);
    if (!carriers.has(mark.holder)) holders.add(mark.holder);
  };
  const marked = verdict.regions.flatMap((region) => region.lines);
  const all = (): Selection => {
    for (const line of marked) note(line.mark);
    if (verdict.lines === 'unweighed') {
      for (const row of verdict.standing) rows.add(row);
      for (const hand of verdict.hands) if (!carriers.has(hand.holder)) holders.add(hand.holder);
    }
    if (verdict.existence !== null) note(verdict.existence);
    return { kind: 'whole', rows: [...rows], carried: { holders: [...holders], external, unknown: false } };
  };
  if (whole) return all();
  if (!verdict.hands.some((hand) => carriers.has(hand.holder)) && !(bearers.nobody && verdict.unheld)) return { kind: 'none' };
  if (verdict.hands.every((hand) => carriers.has(hand.holder)) && (bearers.nobody || !verdict.unheld)) return all();
  if (verdict.lines === 'unweighed') return all();
  const bears = (line: MarkedLine): boolean => (line.mark === 'external' ? bearers.nobody : carriers.has(line.mark.holder));
  const selected = new Set(marked.flatMap((line) => (bears(line) ? [line.unit] : [])));
  const neighbours = new Map<number, Set<number>>();
  const link = (from: number, to: number): void => {
    const forward = neighbours.get(from) ?? new Set<number>();
    forward.add(to);
    neighbours.set(from, forward);
  };
  for (const { from, to } of verdict.links) link(from, to);
  const handOf = new Map<string, number>();
  for (const line of marked) {
    if (line.mark === 'external' || carriers.has(line.mark.holder)) continue;
    const first = handOf.get(line.mark.holder);
    if (first === undefined) handOf.set(line.mark.holder, line.unit);
    else if (first !== line.unit) {
      link(first, line.unit);
      link(line.unit, first);
    }
  }
  const unborne = new Set(bearers.nobody ? [] : marked.flatMap((line) => (line.mark === 'external' ? [line.unit] : [])));
  const pending = [...selected];
  for (let grown = true; grown;) {
    while (pending.length > 0) {
      for (const unit of neighbours.get(pending.pop()!) ?? []) {
        if (selected.has(unit)) continue;
        if (unborne.has(unit)) return { refuse: 'lines-held', holders: [], nobody: true };
        selected.add(unit);
        pending.push(unit);
      }
    }
    grown = false;
    for (const region of verdict.regions) {
      if (!region.lines.some((line) => selected.has(line.unit))) continue;
      for (const line of region.lines) {
        if (line.mark === 'external' || !retired.has(line.mark.holder) || selected.has(line.unit)) continue;
        selected.add(line.unit);
        pending.push(line.unit);
        grown = true;
      }
    }
  }
  if (
    !carriers.has(OPERATOR_KEY) &&
    marked.some((line) => line.mark !== 'external' && line.mark.holder === OPERATOR_KEY && selected.has(line.unit))
  )
    return { refuse: 'lines-held', holders: [OPERATOR_KEY] };
  const take = (line: MarkedLine): boolean => selected.has(line.unit);
  const chosen = verdict.regions.filter((region) => region.lines.some((line) => selected.has(line.unit)));
  const base = contentText(head);
  const bytes = contentText(working);
  if (base === undefined || bytes === undefined) return { refuse: 'walk-cut' };
  if (chosen.length === 0) return { kind: 'none' };
  const offsets = head.kind === 'text' ? head.offsets : [0];
  const older = offsets.length - 1;
  const output: string[] = [];
  const positions: SelectedSpan[] = [];
  const stable: { before: number; after: number; count: number }[] = [];
  let beforeAt = 0;
  let afterAt = 0;
  for (const region of verdict.regions) {
    if (region.before.start > beforeAt) stable.push({ before: beforeAt, after: afterAt, count: region.before.start - beforeAt });
    beforeAt = region.before.end;
    afterAt = region.after.end;
  }
  if (beforeAt < older) stable.push({ before: beforeAt, after: afterAt, count: older - beforeAt });
  let stableAt = 0;
  const pieces: LandedPiece[] = [];
  const removals = new Map<number, Removal>();
  for (const region of verdict.regions)
    for (const line of region.lines) if (line.kind === 'removed' && line.removal !== undefined) removals.set(line.at - 1, line.removal);
  const follows = (last: LandedPiece, removal: Removal | undefined): boolean =>
    last.removal === undefined
      ? removal === undefined
      : removal !== undefined && last.removal.row === removal.row && last.removal.ordinal + last.count === removal.ordinal;
  const piece = (side: LandedPiece['side'], start: number, count: number): void => {
    for (let at = start; at < start + count; at += side === 'head' ? 1 : count) {
      const removal = side === 'head' ? removals.get(at) : undefined;
      const length = side === 'head' ? 1 : count;
      const last = pieces.at(-1);
      if (last !== undefined && last.side === side && last.start + last.count === at && follows(last, removal))
        pieces[pieces.length - 1] = { ...last, count: last.count + length };
      else pieces.push({ side, start: at, count: length, removal });
    }
  };
  const locate = (selected: number, working: number, count: number): void => {
    const last = positions.at(-1);
    if (last !== undefined && last.selected + last.count === selected && last.working + last.count === working)
      positions[positions.length - 1] = { ...last, count: last.count + count };
    else positions.push({ selected, working, count });
  };
  let written = 0;
  const kept = (text: string): void => {
    output.push(text);
    written += 1;
  };
  const unchanged = (from: number, to: number): void => {
    const start = Math.min(from, older);
    const end = Math.min(to, older);
    if (base === null || end <= start) return;
    output.push(base.slice(offsets[start], offsets[end]));
    while (stableAt < stable.length && stable[stableAt]!.before + stable[stableAt]!.count <= start) stableAt += 1;
    let headAt = start;
    for (let at = stableAt; at < stable.length && stable[at]!.before < end; at += 1) {
      const span = stable[at]!;
      const from = Math.max(start, span.before);
      const to = Math.min(end, span.before + span.count);
      piece('head', headAt, from - headAt);
      piece('working', span.after + from - span.before, to - from);
      headAt = to;
      locate(written + from - start + 1, span.after + from - span.before + 1, to - from);
    }
    piece('head', headAt, end - headAt);
    written += end - start;
  };
  const lines: MarkedLine[] = [];
  const added = (line: MarkedLine): void => {
    lines.push({ ...line, at: written + 1 });
    locate(written + 1, line.at, 1);
    piece('working', line.at - 1, 1);
    kept(line.text);
    note(line.mark);
  };
  const removed = (line: MarkedLine): void => {
    lines.push(line);
    note(line.mark);
  };
  let cursor = 0;
  for (const region of chosen) {
    unchanged(cursor, region.before.start);
    const insertions = region.lines.filter((line) => line.kind === 'added');
    let next = 0;
    let reached = -1;
    const insertBefore = (headLine: number): void => {
      for (; next < insertions.length; next += 1) {
        const line = insertions[next]!;
        reached = Math.max(reached, line.follows ?? -1);
        if (reached >= headLine) return;
        if (take(line)) added(line);
      }
    };
    for (const line of region.lines) {
      if (line.kind !== 'removed') continue;
      insertBefore(line.at - 1);
      if (take(line)) removed(line);
      else {
        piece('head', line.at - 1, 1);
        kept(line.text);
      }
    }
    insertBefore(Infinity);
    cursor = region.before.end;
  }
  unchanged(cursor, older);
  const text = bytes === null && written === 0 ? null : output.join('');
  return {
    kind: 'text',
    text,
    lines,
    positions,
    pieces,
    rows: [...rows],
    carried: { holders: [...holders], external, unknown: false },
  };
}
