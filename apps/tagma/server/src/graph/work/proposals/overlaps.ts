import type { ReviewConflict, ReviewConflicts } from '../../contract/service/work.js';
import { placeKey, sourceName, type SourceTarget } from '../../sources/readers/place.js';

type Span = readonly [number, number];
type Interval = { readonly proposal: number; readonly span: Span };
type Branch = { readonly interval: Interval; readonly end: number; readonly left: Branch | null; readonly right: Branch | null };

type TextRegion = {
  readonly region: { readonly kind: 'text'; readonly blockName: string };
  readonly byProposal: Map<number, Span[]>;
  tree: Branch | null;
};

type CodeRegion = {
  readonly region: { readonly kind: 'code'; readonly anchor: string };
  readonly byProposal: Map<number, string[]>;
  readonly byPlace: Map<string, number[]>;
};

type Region = TextRegion | CodeRegion;

export type ConflictSubject = {
  readonly name: string;
  readonly edits: readonly { readonly target: number; readonly old: string }[];
  readonly sources: readonly SourceTarget[];
};

export type ConflictTarget = { readonly name: string; readonly body: string };

export type ConflictInput = {
  readonly proposals: readonly ConflictSubject[];
  readonly targets: ReadonlyMap<number, ConflictTarget>;
  readonly unread: ReviewConflicts['unread'];
};

export type ConflictIndex = {
  readonly names: readonly string[];
  readonly byName: ReadonlyMap<string, number>;
  readonly regions: readonly Region[];
  readonly byProposal: ReadonlyMap<number, ReadonlyMap<number, number>>;
  readonly total: number;
  readonly unread: ReviewConflicts['unread'];
};

function joined(spans: Span[]): Span[] {
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last !== undefined && span[0] <= last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], span[1])];
    else merged.push(span);
  }
  return merged;
}

function branch(intervals: readonly Interval[], from = 0, until = intervals.length): Branch | null {
  if (from === until) return null;
  const middle = (from + until) >>> 1;
  const interval = intervals[middle]!;
  const left = branch(intervals, from, middle);
  const right = branch(intervals, middle + 1, until);
  return { interval, left, right, end: Math.max(interval.span[1], left?.end ?? -1, right?.end ?? -1) };
}

function touching(tree: Branch | null, span: Span, found: Set<number>): void {
  if (tree === null || tree.end <= span[0]) return;
  touching(tree.left, span, found);
  if (tree.interval.span[0] >= span[1]) return;
  if (tree.interval.span[1] > span[0]) found.add(tree.interval.proposal);
  touching(tree.right, span, found);
}

function textCount(region: TextRegion): number {
  const intervals: Interval[] = [];
  let single = true;
  for (const [proposal, spans] of region.byProposal) {
    const merged = joined(spans);
    region.byProposal.set(proposal, merged);
    single &&= merged.length === 1;
    for (const span of merged) intervals.push({ proposal, span });
  }
  intervals.sort((a, b) => a.span[0] - b.span[0]);
  region.tree = branch(intervals);
  let total = 0;
  if (single) {
    const ends = intervals.map((row) => row.span[1]).sort((a, b) => a - b);
    let ended = 0;
    for (const [at, row] of intervals.entries()) {
      while (ended < ends.length && ends[ended]! <= row.span[0]) ended += 1;
      total += at - ended;
    }
    return total;
  }
  for (const [proposal, spans] of region.byProposal) {
    const found = new Set<number>();
    for (const span of spans) touching(region.tree, span, found);
    for (const other of found) if (other > proposal) total += 1;
  }
  return total;
}

function codeCount(region: CodeRegion): number {
  const signatures = new Map<string, { readonly places: readonly string[]; count: number }>();
  for (const places of region.byProposal.values()) {
    places.sort();
    const signature = JSON.stringify(places);
    const group = signatures.get(signature);
    if (group === undefined) signatures.set(signature, { places, count: 1 });
    else group.count += 1;
  }
  let total = 0;
  const groups = [...signatures.values()];
  const byPlace = new Map<string, number[]>();
  for (const [at, group] of groups.entries()) {
    total += (group.count * (group.count - 1)) / 2;
    const others = new Set<number>();
    for (const place of group.places) {
      const previous = byPlace.get(place) ?? [];
      for (const other of previous) others.add(other);
      previous.push(at);
      byPlace.set(place, previous);
    }
    for (const other of others) total += group.count * groups[other]!.count;
  }
  return total;
}

export function indexConflicts(input: ConflictInput): ConflictIndex {
  const regions: Region[] = [];
  const texts = new Map<number, number>();
  const anchors = new Map<string, number>();
  const byProposal = new Map<number, ReadonlyMap<number, number>>();
  const anchorsAt = new Map<number, Map<string, Span[]>>();
  for (const [proposal, subject] of input.proposals.entries()) {
    const membership = new Set<number>();
    for (const edit of subject.edits) {
      const target = input.targets.get(edit.target);
      if (target === undefined) continue;
      let anchors = anchorsAt.get(edit.target);
      if (anchors === undefined) {
        anchors = new Map();
        anchorsAt.set(edit.target, anchors);
      }
      let spans = anchors.get(edit.old);
      if (spans === undefined) {
        spans = [];
        for (let at = target.body.indexOf(edit.old); at !== -1; at = target.body.indexOf(edit.old, at + 1)) {
          spans.push([at, at + edit.old.length]);
        }
        anchors.set(edit.old, spans);
      }
      if (spans.length === 0) continue;
      let id = texts.get(edit.target);
      if (id === undefined) {
        id = regions.length;
        texts.set(edit.target, id);
        regions.push({ region: { kind: 'text', blockName: target.name }, byProposal: new Map(), tree: null });
      }
      const region = regions[id] as TextRegion;
      const standing = region.byProposal.get(proposal) ?? [];
      for (const span of spans) standing.push(span);
      region.byProposal.set(proposal, standing);
      membership.add(id);
    }
    for (const source of subject.sources) {
      const anchor = sourceName(source.ref, source.symbol);
      let id = anchors.get(anchor);
      if (id === undefined) {
        id = regions.length;
        anchors.set(anchor, id);
        regions.push({ region: { kind: 'code', anchor }, byProposal: new Map(), byPlace: new Map() });
      }
      const region = regions[id] as CodeRegion;
      const place = placeKey(source);
      const places = region.byProposal.get(proposal) ?? [];
      if (!places.includes(place)) {
        places.push(place);
        region.byProposal.set(proposal, places);
        const members = region.byPlace.get(place) ?? [];
        members.push(proposal);
        region.byPlace.set(place, members);
      }
      membership.add(id);
    }
    byProposal.set(proposal, new Map([...membership].map((id, order) => [id, order])));
  }
  let total = 0;
  for (const region of regions) total += 'tree' in region ? textCount(region) : codeCount(region);
  const names = input.proposals.map((row) => row.name);
  return { names, byName: new Map(names.map((name, at) => [name, at])), regions, byProposal, total, unread: input.unread };
}

export function conflictsOf(index: ConflictIndex, names?: readonly string[]): ReviewConflicts {
  const selected = names === undefined ? new Set(index.byName.values()) : new Set(names.flatMap((name) => index.byName.get(name) ?? []));
  const found: { readonly a: number; readonly b: number; readonly region: number; readonly order: number }[] = [];
  for (const proposal of selected) {
    for (const id of index.byProposal.get(proposal)?.keys() ?? []) {
      const region = index.regions[id]!;
      const others = new Set<number>();
      if ('tree' in region) {
        for (const span of region.byProposal.get(proposal) ?? []) touching(region.tree, span, others);
      } else {
        for (const place of region.byProposal.get(proposal) ?? []) {
          for (const other of region.byPlace.get(place) ?? []) others.add(other);
        }
      }
      for (const other of others) {
        if (other === proposal || (other < proposal && selected.has(other))) continue;
        const a = Math.min(proposal, other);
        found.push({ a, b: Math.max(proposal, other), region: id, order: index.byProposal.get(a)!.get(id)! });
      }
    }
  }
  found.sort((a, b) => a.a - b.a || a.b - b.b || a.order - b.order);
  return {
    found: found.map((row): ReviewConflict => ({
      a: index.names[row.a]!,
      b: index.names[row.b]!,
      region: index.regions[row.region]!.region,
    })),
    total: index.total,
    unread: index.unread,
  };
}
