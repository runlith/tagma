import type { Tree } from '@runlith/code-facts/tree';
import { createHash } from 'node:crypto';
import {
  type Checked,
  type InspectionMemo,
  type Keyed,
  type MemoValue,
  type Objects,
  parentOf,
  validMemo,
  WHOLE,
  wholeUnit,
} from '../../../core/node/memo';
import type { Violation } from '../../../core/verdict';
import { digestOf } from './closure';
import type { Inventory } from './snapshot';

export type Contribution = { readonly violations: readonly Violation[]; readonly universal: readonly Keyed[] };
export type Inherited = { readonly digests: ReadonlyMap<string, string>; readonly dropped: ReadonlySet<string>; readonly next?: Inherited };
export type Units = {
  readonly paths: Iterable<string>;
  readonly members: string;
  readonly digests: Map<string, string>;
  readonly inherited?: Inherited;
  listed?: ReadonlyMap<string, readonly string[]>;
  children?: ReadonlyMap<string, readonly string[]>;
};

const inheritedDigest = (units: Units, name: string): string | undefined => {
  for (let at = units.inherited; at !== undefined; at = at.next) {
    if (at.dropped.has(name)) return undefined;
    const held = at.digests.get(name);
    if (held !== undefined) {
      units.digests.set(name, held);
      return held;
    }
  }
  return undefined;
};

const childrenOf = (units: Units): ReadonlyMap<string, readonly string[]> => {
  if (units.children !== undefined) return units.children;
  const children = new Map<string, Set<string>>();
  for (const dir of listedOf(units).keys()) {
    for (let at = dir; at !== ''; at = parentOf(at)) {
      const up = parentOf(at);
      const held = children.get(up);
      if (held?.has(at) === true) break;
      if (held === undefined) children.set(up, new Set([at]));
      else held.add(at);
    }
  }
  units.children = new Map([...children].map(([dir, held]) => [dir, [...held].sort()]));
  return units.children;
};

const listedOf = (units: Units): ReadonlyMap<string, readonly string[]> => {
  if (units.listed !== undefined) return units.listed;
  const listed = new Map<string, string[]>();
  for (const path of units.paths) {
    const dir = parentOf(path);
    const held = listed.get(dir);
    if (held === undefined) listed.set(dir, [path]);
    else held.push(path);
  }
  units.listed = listed;
  return listed;
};

const VARIANTS = 4;
const MEMBERS = '["members"]';

export const unitObjects = (tree: Tree, units: Units): Objects | undefined => {
  const object = tree.object;
  if (object === undefined) return undefined;
  const objects = (name: string): string | null => {
    if (!name.endsWith('/')) return object(name) ?? null;
    const held = units.digests.get(name) ?? inheritedDigest(units, name);
    if (held !== undefined) return held;
    const whole = name.endsWith(WHOLE);
    const dir = name.slice(0, whole ? -WHOLE.length : -1);
    const hash = createHash('sha256');
    for (const path of listedOf(units).get(dir) ?? [])
      hash
        .update(path)
        .update('\0')
        .update(whole ? (object(path) ?? '') : '')
        .update('\0');
    if (whole)
      for (const child of childrenOf(units).get(dir) ?? [])
        hash
          .update(child)
          .update('\0')
          .update(objects(wholeUnit(child)) ?? '')
          .update('\0');
    const digest = hash.digest('hex');
    units.digests.set(name, digest);
    return digest;
  };
  return objects;
};

const lead = (memo: InspectionMemo, index: string, key: string): void => {
  const kept = (memo.get(index)?.parents ?? []).filter((one) => one !== key).slice(0, VARIANTS - 1);
  memo.set(index, { dependencies: [], listings: [], parents: [key, ...kept], violations: [], read: [] });
};

export const variantOf = (memo: InspectionMemo, index: string, holds: (key: string) => boolean): string | undefined => {
  const variants = memo.get(index)?.parents ?? [];
  const found = variants.find(holds);
  if (found !== undefined && found !== variants[0]) lead(memo, index, found);
  return found;
};

export const remember = (memo: InspectionMemo, index: string, key: string, value: MemoValue): void => {
  memo.set(key, value);
  lead(memo, index, key);
};

const footprintOf = (dir: string, keys: readonly string[], objects: Objects, memo: InspectionMemo, inventory: Inventory) => {
  const unit = wholeUnit(dir);
  const dependencies = new Map<string, string | null>([[unit, objects(unit)]]);
  const listings = new Map<string, string>();
  const seen = new Set<string>();
  const pending = [...keys];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = memo.get(key);
    if (value === undefined) return undefined;
    for (const [name, object] of value.dependencies) {
      const owner = inventory.ownerOf(name);
      if (owner === undefined) dependencies.set(name, object);
      else {
        const unit = wholeUnit(owner.member.dir);
        if (!dependencies.has(unit)) dependencies.set(unit, objects(unit));
      }
    }
    for (const [query, stamp] of value.listings) listings.set(query, stamp);
    pending.push(...(value.parents ?? []));
  }
  return { dependencies, listings };
};

export type Ledger = {
  readonly reuse: (part: string | null) => Contribution | undefined;
  readonly write: (part: string | null, dir: string | undefined, own: Contribution, keys: readonly string[]) => void;
};

export function ledgerOf(
  namespace: string,
  objects: Objects | undefined,
  members: string,
  memo: InspectionMemo,
  listing: (query: string) => string,
  checked: Checked,
  inventory: Inventory,
): Ledger {
  const stampOf = (query: string): string => (query === MEMBERS ? members : listing(query));
  const indexOf = (part: string): string => `platforms/contributions/${namespace}/${part}`;
  return {
    reuse: (part) => {
      if (part === null) return undefined;
      const key = variantOf(memo, indexOf(part), (one) => validMemo(one, objects, stampOf, memo, checked));
      const value = key === undefined ? undefined : memo.get(key);
      return value === undefined ? undefined : { violations: value.violations, universal: value.universal ?? [] };
    },
    write: (part, dir, own, keys) => {
      if (part === null || dir === undefined || dir === '' || objects === undefined) return;
      const footprint = footprintOf(dir, keys, objects, memo, inventory);
      if (footprint === undefined) return;
      const variant: MemoValue = {
        dependencies: [...footprint.dependencies],
        listings: [[MEMBERS, members], ...footprint.listings],
        violations: own.violations,
        universal: own.universal,
        read: [],
      };
      remember(memo, indexOf(part), `platforms/contribution/${digestOf(variant)}`, variant);
    },
  };
}
