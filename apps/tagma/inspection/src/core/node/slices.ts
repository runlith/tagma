import type { Tree } from '@runlith/code-facts/tree';
import type { Applied, Envelope } from '../rule';
import type { Unjudged, Violation } from '../verdict';
import type { Change, InspectionMemo, Keyed, MemoStats } from './memo';
import type { Near, Slicing } from './reading';
import { implementationOf, ruleOf } from './registry';

export type Part = { readonly package: string | null; readonly judged: boolean };
export type Entry = { readonly platform: string; readonly file: string };
export type Scope = { readonly parts: readonly Part[] | 'whole'; readonly entries: readonly Entry[] };
export type Need = Entry & { readonly package: string | null };
export type Sliced = {
  readonly violations: readonly Violation[];
  readonly universal: readonly Keyed[];
  readonly needs: readonly Need[];
  readonly stats?: MemoStats;
};
export type Planned = { readonly parts: readonly Part[]; readonly files: number; readonly bytes: number };
export type Plan = { readonly slices: readonly Planned[]; readonly envelope: Envelope; readonly headroom: number };
export type Step = { readonly slice: number; readonly scope: Scope };

export const WHOLE: Scope = { parts: 'whole', entries: [] };

export class SliceExceeded extends Error {}

export const sliceExceeded = (error: unknown): boolean => error instanceof SliceExceeded;

export class Unsliced extends Error {
  constructor(readonly id: string) {
    super(`${id} is not judged in slices`);
    this.name = 'Unsliced';
  }
}

const slicingOf = (inspection: Applied): Slicing<unknown> => {
  const slices = implementationOf(inspection.builtin).slices;
  if (slices === undefined) throw new Unsliced(inspection.builtin);
  return slices;
};

export const sliceEnvelopeOf = (inspection: Applied): Envelope => {
  const envelope = ruleOf(inspection.builtin).envelope;
  if (envelope === undefined) throw new Unsliced(inspection.builtin);
  return envelope;
};

export const snapshotOf = (inspection: Applied, tree: Tree, near?: Near): unknown =>
  slicingOf(inspection).snapshot(inspection.params, tree, near);

export const carriesOf = (inspection: Applied, before: Tree, after: Tree, changes: readonly Change[]): boolean =>
  slicingOf(inspection).carries(inspection.params, before, after, changes);

export const comparesOf = (inspection: Applied): readonly string[] => slicingOf(inspection).compares(inspection.params);

export const planOf = (
  inspection: Applied,
  tree: Tree,
  places: readonly string[],
  snapshot?: unknown,
  envelope: Envelope = sliceEnvelopeOf(inspection),
): Plan => slicingOf(inspection).plan(inspection.params, tree, places, envelope, snapshot);

export const measuredOf = (
  inspection: Applied,
  tree: Tree,
  scope: Scope,
  memo: InspectionMemo,
  trusted?: InspectionMemo,
  snapshot?: unknown,
  places?: readonly string[],
): Sliced => slicingOf(inspection).measured(inspection.params, tree, scope, memo, trusted, snapshot, places);

export const sliceOf = (
  inspection: Applied,
  tree: Tree,
  scope: Scope,
  memo?: InspectionMemo,
  trusted?: InspectionMemo,
  snapshot?: unknown,
  places?: readonly string[],
): Sliced => slicingOf(inspection).read(inspection.params, tree, scope, memo, trusted, snapshot, places);

export const keep = (universal: Map<string, Violation>, { key, violation }: Keyed): void => {
  const held = universal.get(key);
  if (held === undefined || violation.fingerprint < held.fingerprint) universal.set(key, violation);
};

export function mergeSlices(readings: readonly Sliced[]): {
  readonly violations: readonly Violation[];
  readonly unjudged: readonly Unjudged[];
} {
  const universal = new Map<string, Violation>();
  const found = new Map<string, Violation>();
  for (const reading of readings) {
    for (const one of reading.universal) keep(universal, one);
    for (const one of reading.violations) if (!found.has(one.fingerprint)) found.set(one.fingerprint, one);
  }
  for (const one of universal.values()) found.set(one.fingerprint, one);
  return { violations: [...found.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)), unjudged: [] };
}

type Group = {
  parts: Part[];
  readonly entries: Map<string, Need>;
  ran?: ReadonlySet<string>;
  reading?: Sliced;
  waits: Set<number>;
  alive: boolean;
};

export type Schedule = {
  readonly next: () => Step | undefined;
  readonly answer: (step: Step, sliced: Sliced) => void;
  readonly split: (step: Step) => void;
  readonly readings: () => readonly Sliced[];
};

const entryOf = ({ platform, file }: Entry): string => `${platform}\0${file}`;

export function schedule(plan: Plan): Schedule {
  const groups: Group[] = plan.slices.map(({ parts }) => ({ parts: [...parts], entries: new Map(), waits: new Set(), alive: true }));
  const order = groups.map((_, at) => at);
  const owner = new Map<string | null, number>();
  const exceeded = new Set<string>();
  groups.forEach((group, at) => {
    for (const part of group.parts) owner.set(part.package, at);
  });
  const done = (at: number): boolean =>
    groups[at]!.ran !== undefined && [...groups[at]!.entries.keys()].every((key) => groups[at]!.ran!.has(key));
  const wanted = (at: number): boolean =>
    groups[at]!.alive && !done(at) && (groups[at]!.parts.some(({ judged }) => judged) || groups[at]!.entries.size > 0);
  const merge = (members: readonly number[]): void => {
    const at = groups.length;
    const joined: Group = { parts: [], entries: new Map(), waits: new Set(), alive: true };
    for (const member of members) {
      const group = groups[member]!;
      joined.parts.push(...group.parts);
      for (const [key, entry] of group.entries) joined.entries.set(key, entry);
      for (const wait of group.waits) if (!members.includes(wait)) joined.waits.add(wait);
      group.alive = false;
    }
    groups.push(joined);
    for (const part of joined.parts) owner.set(part.package, at);
    for (const group of groups) {
      if (!group.alive || group === joined) continue;
      if (members.some((member) => group.waits.delete(member))) group.waits.add(at);
    }
    order.splice(Math.min(...members.map((member) => order.indexOf(member))), 0, at);
  };
  const split = (step: Step): void => {
    const group = groups[step.slice]!;
    const names = group.parts.map((part) => part.package ?? 'files outside packages').sort();
    const signature = names.join('\0');
    if (group.parts.length < 2 || exceeded.has(signature))
      throw new Error(`indivisible package group ${names.join(', ')} exceeds its slice's work ceiling`);
    exceeded.add(signature);
    const middle = Math.floor(group.parts.length / 2);
    const halves = [group.parts.slice(0, middle), group.parts.slice(middle)];
    const children = halves.map((parts) => {
      const at = groups.length;
      const entries = new Map([...group.entries].filter(([, entry]) => parts.some((part) => part.package === entry.package)));
      groups.push({ parts, entries, waits: new Set(group.waits), alive: true });
      for (const part of parts) owner.set(part.package, at);
      return at;
    });
    group.alive = false;
    for (const live of groups) {
      if (!live.alive || live.waits.delete(step.slice) === false) continue;
      for (const child of children) live.waits.add(child);
    }
    order.splice(order.indexOf(step.slice), 1, ...children);
  };
  const next = (): Step | undefined => {
    for (;;) {
      const live = order.filter((at) => groups[at]!.alive && wanted(at));
      if (live.length === 0) return undefined;
      const ready = live.find((at) => [...groups[at]!.waits].every((wait) => !wanted(wait)));
      if (ready !== undefined) {
        const group = groups[ready]!;
        return { slice: ready, scope: { parts: group.parts, entries: [...group.entries.values()] } };
      }
      const path: number[] = [];
      let at = live[0]!;
      while (!path.includes(at)) {
        path.push(at);
        at = [...groups[at]!.waits].find((wait) => wanted(wait))!;
      }
      merge(path.slice(path.indexOf(at)));
    }
  };
  const answer = (step: Step, sliced: Sliced): void => {
    const group = groups[step.slice]!;
    const ran = new Set(step.scope.entries.map(entryOf));
    group.waits = new Set();
    if (sliced.needs.length === 0) {
      group.ran = ran;
      group.reading = sliced;
      return;
    }
    for (const need of sliced.needs) {
      let target = owner.get(need.package);
      if (target === undefined) {
        target = groups.length;
        groups.push({ parts: [{ package: need.package, judged: false }], entries: new Map(), waits: new Set(), alive: true });
        order.unshift(target);
        owner.set(need.package, target);
      }
      if (target === step.slice) throw new Error(`the slice owning ${need.file} asked for its own frontier`);
      const key = entryOf(need);
      if (groups[target]!.ran?.has(key))
        throw new Error(
          `the frontier summary of ${need.file} on ${need.platform} was computed and then not found; the memo store dropped it between asks`,
        );
      groups[target]!.entries.set(key, need);
      group.waits.add(target);
    }
  };
  return {
    next,
    answer,
    split,
    readings: () => groups.flatMap((group) => (group.alive && group.reading !== undefined ? [group.reading] : [])),
  };
}
