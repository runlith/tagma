import { createHash } from 'node:crypto';
import type { Violation } from '../../../core/verdict';
import type { Hit, InspectionMemo, Keyed, MemoValue } from '../../../core/node/memo';
import { SliceExceeded } from '../../../core/node/slices';

export type Site = { readonly file: string; readonly line: number; readonly specifier: string };
export type Wording = { readonly message: string; readonly fix: string };
export type Cause = Site &
  Wording & {
    readonly group: string;
    readonly suffix: string;
    readonly origin?: string;
    readonly absent?: readonly string[];
  };
export type Edge = Site & { readonly to: string; readonly handoff: boolean };
export type File = {
  readonly edges: Edge[];
  readonly causes: Cause[];
  readonly dependencies: Map<string, string | null>;
  readonly installed: Map<string, string | null>;
  readonly listings: Map<string, string>;
  readonly violations: Violation[];
  readonly universal: Keyed[];
};
export type Start = { readonly id: string; readonly label?: string; readonly file: string; readonly package?: string };
export const digestOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const bySite = (a: Site & { readonly to?: string }, b: Site & { readonly to?: string }): number =>
  a.line - b.line || (a.to ?? a.specifier).localeCompare(b.to ?? b.specifier);

export type Reached = { readonly hits: (file: string) => readonly Hit[] };

export class ClosureExceeded extends SliceExceeded {
  constructor(limit: number, group?: readonly string[]) {
    super(
      `platforms is not judged: its closure exceeds ${limit} reached-file or chain steps in one slice${group === undefined ? '' : ` (${group.join(', ')})`}`,
    );
    this.name = 'ClosureExceeded';
  }
}

export function reachOf(
  files: ReadonlyMap<string, File>,
  frontier: ReadonlyMap<string, readonly Hit[]>,
  spend: (units: number) => void = () => undefined,
): Reached {
  const edges = new Map<string, Edge[]>();
  const reverse = new Map<string, { readonly from: string; readonly handoff: boolean }[]>();
  type Group = {
    readonly origin?: string;
    readonly suffix: string;
    readonly causes: Map<string, Cause>;
    readonly seeds: [string, number][];
  };
  const groups = new Map<string, Group>();
  const groupOf = (group: string, origin: string | undefined, suffix: string): Group => {
    let held = groups.get(group);
    if (held === undefined) groups.set(group, (held = { origin, suffix, causes: new Map(), seeds: [] }));
    return held;
  };
  const frontierHits = new Map<string, Map<string, Hit>>();
  for (const [file, hits] of frontier) frontierHits.set(file, new Map(hits.map((hit) => [hit.group, hit])));
  for (const [file, node] of files) {
    edges.set(file, [...node.edges].sort(bySite));
    for (const edge of node.edges) {
      if (!files.has(edge.to)) {
        for (const hit of frontier.get(edge.to) ?? []) {
          if (edge.handoff && hit.origin === undefined) continue;
          spend(1);
          groupOf(hit.group, hit.origin, hit.suffix).seeds.push([file, 1 + hit.distance]);
        }
        continue;
      }
      const held = reverse.get(edge.to);
      if (held === undefined) reverse.set(edge.to, [{ from: file, handoff: edge.handoff }]);
      else held.push({ from: file, handoff: edge.handoff });
    }
    for (const cause of node.causes) {
      const group = groupOf(cause.group, cause.origin, cause.suffix);
      const held = group.causes.get(file);
      if (held === undefined || bySite(cause, held) < 0) group.causes.set(file, cause);
      spend(1);
      group.seeds.push([file, 0]);
    }
  }
  const distances = new Map<string, Map<string, number>>();
  const reachedAt = new Map<string, string[]>();
  for (const [name, group] of groups) {
    const distance = new Map<string, number>();
    const buckets: string[][] = [];
    const offer = (file: string, at: number): void => {
      const held = distance.get(file);
      if (held !== undefined && held <= at) return;
      spend(1);
      distance.set(file, at);
      (buckets[at] ??= []).push(file);
    };
    for (const [file, at] of group.seeds) offer(file, at);
    for (let at = 0; at < buckets.length; at += 1) {
      for (const file of buckets[at] ?? []) {
        if (distance.get(file) !== at) continue;
        const held = reachedAt.get(file);
        if (held === undefined) reachedAt.set(file, [name]);
        else if (held[held.length - 1] !== name) held.push(name);
        for (const { from, handoff } of reverse.get(file) ?? []) {
          if (handoff && group.origin === undefined) continue;
          offer(from, at + 1);
        }
      }
    }
    distances.set(name, distance);
  }
  const hitOf = (name: string, file: string): Hit => {
    const group = groups.get(name)!,
      distance = distances.get(name)!;
    const chain: string[] = [];
    for (let at = file; ;) {
      const here = distance.get(at)!;
      const own = here === 0 ? group.causes.get(at) : undefined;
      if (own !== undefined) {
        spend(chain.length);
        return {
          group: name,
          origin: group.origin,
          suffix: group.suffix,
          distance: distance.get(file)!,
          chain,
          file: own.file,
          line: own.line,
          specifier: own.specifier,
          message: own.message,
          fix: own.fix,
          absent: own.absent,
        };
      }
      let moved = false;
      for (const edge of edges.get(at) ?? []) {
        if (edge.handoff && group.origin === undefined) continue;
        if (!files.has(edge.to)) {
          const hit = frontierHits.get(edge.to)?.get(name);
          if (hit === undefined || 1 + hit.distance !== here) continue;
          spend(chain.length + 1 + hit.chain.length);
          return { ...hit, distance: distance.get(file)!, chain: [...chain, edge.to, ...hit.chain] };
        }
        if (distance.get(edge.to) !== here - 1) continue;
        chain.push(edge.to);
        at = edge.to;
        moved = true;
        break;
      }
      if (!moved) throw new Error(`platforms: ${at} holds a distance to ${name} that no edge explains`);
    }
  };
  return { hits: (file) => (reachedAt.get(file) ?? []).map((name) => hitOf(name, file)) };
}

export const isEntry = (value: MemoValue): boolean => value.hits !== undefined;

export function collectInto(
  get: (key: string) => MemoValue | undefined,
  keys: Iterable<string>,
  seen: Set<string>,
  violations: Violation[],
  universal: Keyed[],
): void {
  const queue = [...keys];
  for (let at = 0; at < queue.length; at += 1) {
    const key = queue[at]!;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = get(key);
    if (value === undefined) throw new Error(`platforms: the memo chain names ${key}, which the store no longer holds`);
    violations.push(...value.violations);
    universal.push(...(value.universal ?? []));
    if (!isEntry(value)) queue.push(...(value.parents ?? []));
  }
}

const byKey = (left: readonly [string, unknown], right: readonly [string, unknown]): number =>
  left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;

export function memoDependencies(
  files: ReadonlyMap<string, File>,
  memo: InspectionMemo,
  entryKey: (file: string) => string,
): ReadonlyMap<string, string> {
  const reverse = new Map<string, string[]>();
  for (const [file, node] of files)
    for (const { to } of node.edges) {
      if (!files.has(to)) continue;
      const held = reverse.get(to);
      if (held === undefined) reverse.set(to, [file]);
      else held.push(file);
    }
  const seen = new Set<string>(),
    order: string[] = [];
  for (const start of files.keys()) {
    if (seen.has(start)) continue;
    const stack: { file: string; at: number }[] = [{ file: start, at: 0 }];
    seen.add(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const edges = files.get(top.file)!.edges;
      const edge = edges[top.at++];
      if (edge === undefined) {
        order.push(top.file);
        stack.pop();
        continue;
      }
      if (!files.has(edge.to) || seen.has(edge.to)) continue;
      seen.add(edge.to);
      stack.push({ file: edge.to, at: 0 });
    }
  }
  const component = new Map<string, number>(),
    groups: string[][] = [];
  for (const start of order.reverse()) {
    if (component.has(start)) continue;
    const id = groups.length,
      group: string[] = [],
      pending = [start];
    groups.push(group);
    component.set(start, id);
    while (pending.length > 0) {
      const file = pending.pop()!;
      group.push(file);
      for (const from of reverse.get(file) ?? []) {
        if (component.has(from)) continue;
        component.set(from, id);
        pending.push(from);
      }
    }
  }
  const keys = new Map<number, string>();
  for (let id = groups.length - 1; id >= 0; id -= 1) {
    const dependencies = new Map<string, string | null>(),
      installed = new Map<string, string | null>(),
      listings = new Map<string, string>(),
      parents = new Set<string>();
    const violations: Violation[] = [],
      universal: Keyed[] = [];
    for (const file of groups[id]!) {
      const node = files.get(file)!;
      violations.push(...node.violations);
      universal.push(...node.universal);
      for (const [path, object] of node.dependencies) dependencies.set(path, object);
      for (const [path, stamp] of node.installed) installed.set(path, stamp);
      for (const [query, stamp] of node.listings) listings.set(query, stamp);
      for (const edge of node.edges) {
        const target = component.get(edge.to);
        if (target === undefined) {
          parents.add(entryKey(edge.to));
          continue;
        }
        if (target === id) continue;
        parents.add(keys.get(target)!);
      }
    }
    const value: MemoValue = {
      dependencies: [...dependencies].sort(byKey),
      ...(installed.size === 0 ? {} : { installed: [...installed].sort(byKey) }),
      listings: [...listings].sort(byKey),
      parents: [...parents].sort(),
      violations,
      universal,
      read: [],
    };
    const key = `platforms/dependencies/${digestOf(value)}`;
    memo.set(key, value);
    keys.set(id, key);
  }
  return new Map([...component].map(([file, id]) => [file, keys.get(id)!]));
}
