import type { Deadline } from '@runlith/utils/sequenceDiff';
import type { Consumer, FoldState, Unknown } from './folding.js';
import { RemovalIndex, spanOf, type Frame, type MarkSpan } from './intervals.js';
import { keyOf, lookup, runsOf, valuesOf, type Source, type Writer, type KeyTree } from './marks.js';
import type { Region } from './projection.js';
import { lineIn, sliceText, type TextSlice } from './text.js';

export type EditLink = { readonly from: number; readonly to: number };

type HeldUnit = { readonly unit: number; readonly holder: string };
type LinkSource = { readonly holder: string; readonly added: TextSlice; readonly affected: readonly TextSlice[] };
export type LinkWork = {
  readonly links: readonly EditLink[];
  readonly normalized: boolean;
  readonly sources: readonly LinkSource[];
  readonly regions: readonly Region[];
};

const addLink = (links: EditLink[], from: number, to: number, both = true): void => {
  if (from === to) return;
  links.push({ from, to });
  if (both) links.push({ from: to, to: from });
};

export function prepareLinks(
  state: FoldState,
  head: Frame,
  absent: boolean,
  regions: readonly Region[],
  budget: Deadline,
): LinkWork | Unknown {
  const links: EditLink[] = [];
  const seen = new Set<Source>();
  const pending = [...valuesOf(state.snapshot.live)];
  const existence = state.snapshot.existence;
  const creators = !absent
    ? []
    : typeof existence === 'string'
      ? [...new Set(regions.flatMap((region) => region.lines.flatMap((line) => (line.mark === 'external' ? [line.unit] : []))))]
      : (lookup(state.snapshot.byRow, existence.row) ?? []).map((source) => source.serial);
  while (pending.length > 0) {
    const source = pending.pop()!;
    if (seen.has(source)) continue;
    seen.add(source);
    if (budget.expired(1)) return { reason: 'budget' };
    for (const creator of creators) addLink(links, source.serial, creator, false);
    const parents =
      source.displaced.length > 0
        ? source.displaced
        : source.left?.source === source.right?.source && source.left !== null
          ? [source.left.source]
          : [];
    for (const parent of parents) {
      if (parent.mark === 'base' || head.positions.has(parent)) continue;
      addLink(links, source.serial, parent.serial);
      pending.push(parent);
    }
  }
  const sources: LinkSource[] = [];
  for (const source of seen) {
    if (typeof source.mark === 'string') continue;
    const affected: TextSlice[] = [];
    for (const rope of [source.removed, source.origins])
      for (const run of runsOf(rope)) affected.push(sliceText(run.source.shared, run.offset, run.offset + run.count));
    sources.push({ holder: source.mark.holder, added: source.shared, affected });
  }
  return { links, normalized: state.normalized, sources, regions };
}

export function linksOf(work: LinkWork, budget: Deadline): readonly EditLink[] | Unknown {
  const links = [...work.links];
  const affected = new Map<string, Set<string>>();
  const introduced = new Map<string, Set<string>>();
  for (const source of work.sources) {
    const holder = source.holder;
    const note = (text: string): void => {
      const key = keyOf(text, work.normalized);
      const holders = affected.get(key) ?? new Set<string>();
      holders.add(holder);
      affected.set(key, holders);
    };
    for (let at = 0; at + 1 < source.added.offsets.length; at += 1) {
      if (budget.expired(1)) return { reason: 'budget' };
      const text = lineIn(source.added, at);
      note(text);
      const key = keyOf(text, work.normalized);
      const holders = introduced.get(key) ?? new Set<string>();
      holders.add(holder);
      introduced.set(key, holders);
    }
    for (const text of source.affected) {
      if (budget.expired(text.offsets.length - 1)) return { reason: 'budget' };
      for (let at = 0; at + 1 < text.offsets.length; at += 1) note(lineIn(text, at));
    }
  }
  for (const region of work.regions) {
    const writers = new Map<string, HeldUnit>();
    const units = new Map<string, Map<number, HeldUnit>>();
    const coupled = new Set<string>();
    const texts = new Set<string>();
    const repeated = new Map<string, HeldUnit>();
    const removed = new Map<string, HeldUnit>();
    for (const line of region.lines) {
      if (line.mark === 'external') continue;
      const holder = line.mark.holder;
      const unit: HeldUnit = { unit: line.unit, holder };
      const group = units.get(holder) ?? new Map<number, HeldUnit>();
      group.set(line.unit, unit);
      units.set(holder, group);
      writers.set(holder, unit);
      const text = keyOf(line.text, work.normalized);
      const previous = repeated.get(text);
      if (previous !== undefined && previous.holder !== holder) {
        addLink(links, previous.unit, line.unit);
        coupled.add(previous.holder);
        coupled.add(holder);
      }
      repeated.set(text, unit);
      if (line.kind === 'added') texts.add(text);
      else removed.set(text, unit);
    }
    if (writers.size > 1)
      for (const [text, mark] of removed) {
        const holders = introduced.get(text);
        if (holders === undefined) continue;
        const candidates = holders.size < writers.size ? holders : writers.keys();
        for (const holder of candidates) {
          if (budget.expired(1)) return { reason: 'budget' };
          const writer = writers.get(holder);
          if (writer === undefined || holder === mark.holder || !holders.has(holder)) continue;
          addLink(links, mark.unit, writer.unit);
          coupled.add(mark.holder);
          coupled.add(holder);
        }
      }
    for (const text of writers.size < 2 ? [] : texts) {
      const holders = affected.get(text);
      if (holders === undefined) continue;
      let first: HeldUnit | undefined;
      const candidates = holders.size < writers.size ? holders : writers.keys();
      for (const holder of candidates) {
        if (budget.expired(1)) return { reason: 'budget' };
        const writer = writers.get(holder);
        if (writer === undefined || !holders.has(holder)) continue;
        if (first === undefined) first = writer;
        else {
          addLink(links, first.unit, writer.unit);
          coupled.add(first.holder);
          coupled.add(holder);
        }
      }
    }
    for (const holder of coupled) {
      const first = writers.get(holder)!;
      for (const writer of units.get(holder)!.values()) addLink(links, first.unit, writer.unit);
    }
  }
  return links;
}

export function writersOf(state: FoldState): readonly Writer[] {
  const writers: Writer[] = [];
  for (let link = state.rows; link !== null; link = link.previous) writers.push({ row: link.row.id, holder: link.row.holder });
  return writers.reverse();
}

export function removalsOf(state: FoldState, head: Frame, budget: Deadline): RemovalIndex | Unknown {
  const spans: MarkSpan[] = [];
  const historical = [...head.positions.keys()].some((source) => typeof source.mark !== 'string');
  for (const source of valuesOf(state.snapshot.live)) {
    for (const run of runsOf(source.origins)) {
      if (budget.expired(1)) return { reason: 'budget' };
      spans.push(spanOf(run, source));
    }
    if (!historical) continue;
    const pending = [source];
    const visited = new Set<Source>();
    while (pending.length > 0) {
      const previous = pending.pop() as Source;
      if (visited.has(previous)) continue;
      visited.add(previous);
      for (const run of runsOf(previous.removed)) {
        if (budget.expired(1)) return { reason: 'budget' };
        if (run.source.mark === 'base') continue;
        if (head.positions.has(run.source)) spans.push(spanOf(run, source));
        else if (previous.inherited.includes(run.source)) pending.push(run.source);
      }
    }
  }
  return new RemovalIndex(spans);
}

export class Overwrites implements ReadonlyMap<string, readonly string[]> {
  private readonly memo = new Map<string, readonly string[] | null>();
  readonly [Symbol.toStringTag] = 'Map';
  constructor(
    private readonly consumers: KeyTree<Consumer>,
    private readonly active: KeyTree<boolean>,
    private readonly records: KeyTree<string | null>,
    private readonly standing: ReadonlySet<string>,
    private readonly settled: ReadonlySet<string>,
  ) {}

  get(row: string): readonly string[] | undefined {
    const stack: { readonly row: string; readonly expanded: boolean }[] = [{ row, expanded: false }];
    while (stack.length > 0) {
      const current = stack.pop() as (typeof stack)[number];
      if (this.memo.has(current.row)) continue;
      if (this.standing.has(current.row) || this.settled.has(current.row)) {
        this.memo.set(current.row, null);
        continue;
      }
      const edges: Consumer[] = [];
      for (let edge = lookup(this.consumers, current.row); edge != null; edge = edge.previous ?? undefined)
        if (lookup(this.active, String(edge.serial))) edges.push(edge);
      if (edges.some((source) => typeof source.mark === 'string')) {
        this.memo.set(current.row, null);
        continue;
      }
      const children = [
        ...new Set(
          edges.flatMap((source) => (typeof source.mark === 'string' || source.mark.row === current.row ? [] : [source.mark.row])),
        ),
      ];
      if (!current.expanded) {
        stack.push({ row: current.row, expanded: true });
        for (const child of children) if (!this.standing.has(child) && !this.memo.has(child)) stack.push({ row: child, expanded: false });
        continue;
      }
      const leaves = new Set<string>();
      let complete = children.length > 0;
      for (const child of children) {
        const found = this.standing.has(child) ? [child] : this.memo.get(child);
        if (found == null) {
          complete = false;
          break;
        }
        for (const leaf of found) leaves.add(leaf);
      }
      this.memo.set(current.row, complete ? [...leaves] : null);
    }
    return this.memo.get(row) ?? undefined;
  }
  has(row: string): boolean {
    return this.get(row) !== undefined;
  }
  *entries(): MapIterator<[string, readonly string[]]> {
    const pending = [this.records];
    while (pending.length > 0) {
      const tree = pending.pop();
      if (tree == null) continue;
      pending.push(tree.right, tree.left);
      const value = this.get(tree.key);
      if (value !== undefined) yield [tree.key, value];
    }
  }
  *keys(): MapIterator<string> {
    for (const [key] of this.entries()) yield key;
  }
  *values(): MapIterator<readonly string[]> {
    for (const [, value] of this.entries()) yield value;
  }
  [Symbol.iterator](): MapIterator<[string, readonly string[]]> {
    return this.entries();
  }
  get size(): number {
    let size = 0;
    for (const _ of this.entries()) size += 1;
    return size;
  }
  forEach(callback: (value: readonly string[], key: string, map: ReadonlyMap<string, readonly string[]>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
  }
}
