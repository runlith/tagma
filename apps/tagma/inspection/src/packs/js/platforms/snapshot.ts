import { js } from '@runlith/code-facts/adapters';
import { type Member, workspaceMembers } from '@runlith/code-facts/js/workspace';
import type { Tree } from '@runlith/code-facts/tree';
import { posix } from 'node:path';
import { type Change, parentOf, touchedNames } from '../../../core/node/memo';
import type { Near } from '../../../core/node/reading';
import { globPaths, picks } from '../../../core/node/select';
import { Layered, SortedPaths } from '../../../core/node/sorted';
import type { Violation } from '../../../core/verdict';
import { digestOf } from './closure';
import type { platforms } from './declaration';
import { manifestOf } from './doors';
import type { Inherited, Units } from './records';
import { WORKSPACE_FIX } from './wording';

export type Of = typeof platforms.params.Type;
export type Owner = { readonly name: string; readonly member: Member };
export type Inventory = {
  readonly manifest: string;
  readonly packages: ReadonlyMap<string, Member>;
  readonly ownerOf: (file: string) => Owner | undefined;
};
type Sized = { readonly files: number; readonly bytes: number };
export type Sizes = {
  readonly packages: ReadonlyMap<string, Sized>;
  readonly shared: Sized;
  readonly outliers: { readonly files: readonly string[]; readonly bytes: number };
};
export type Snapshot = {
  readonly paths: SortedPaths;
  readonly inventory: Inventory;
  readonly packagePaths: ReadonlyMap<string, SortedPaths>;
  readonly globs: Map<string, readonly string[]>;
  readonly units: Units;
  readonly size: (path: string) => number;
  sized?: Sizes;
};

export const inside = (path: string, root: string): boolean =>
  root === '' || path === root || path.startsWith(`${root.replace(/\/$/, '')}/`);
export const pathOf = (root: string, path: string): string => posix.join(root, path);
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export const covered = (places: readonly string[], path: string): boolean =>
  places.some((place) => inside(path, place) || inside(place, path));

const manifest = (path: string): boolean => path === 'package.json' || path.endsWith('/package.json');

const inventoryOf = (tree: Tree, base: string): Inventory => {
  const found = workspaceMembers(tree, base);
  if (found === null) throw new Error('No workspace manifest declares the packages');
  const byDirectory = new Map([...found.packages].map(([name, member]) => [member.dir, { name, member }]));
  const owners = new Map<string, Owner | undefined>();
  const ownerOf = (file: string): Owner | undefined => {
    const dir = posix.dirname(file);
    if (owners.has(dir)) return owners.get(dir);
    const owner = byDirectory.get(dir) ?? (dir === '.' || dir === '' || dir === file ? undefined : ownerOf(dir));
    owners.set(dir, owner);
    return owner;
  };
  return { manifest: found.manifest, packages: found.packages, ownerOf };
};

export const workspaceFailure = (base: string, error: unknown): Violation => ({
  fingerprint: `workspace -> unresolved package.json @ ${base || '.'}`,
  file: base || 'package.json',
  line: 1,
  message: messageOf(error),
  fix: WORKSPACE_FIX,
});

const sizeOf =
  (source: Tree) =>
  (path: string): number =>
    source.size?.(path) ?? 0;

export function snapshotOf(params: Of, source: Tree, near?: Near<Snapshot>): Snapshot {
  const derived = near === undefined ? undefined : derivedOf(params, source, near);
  if (derived !== undefined) return derived;
  const paths = SortedPaths.of(source.paths?.() ?? []);
  const inventory = inventoryOf(source, params.base);
  const owned = new Map<string, string[]>();
  for (const path of paths) {
    const name = inventory.ownerOf(path)?.name;
    if (name === undefined) continue;
    const held = owned.get(name);
    if (held === undefined) owned.set(name, [path]);
    else held.push(path);
  }
  const packagePaths = Layered.of(new Map([...owned].map(([name, held]) => [name, SortedPaths.of(held)] as const)));
  const members = digestOf([inventory.manifest, ...[...inventory.packages].map(([name, member]) => [name, member.dir])]);
  return { paths, inventory, packagePaths, globs: new Map(), units: { paths, members, digests: new Map() }, size: sizeOf(source) };
}

function derivedOf(params: Of, source: Tree, { snapshot: old, changes }: Near<Snapshot>): Snapshot | undefined {
  const relevant = changes.filter(
    ({ path, before, after }) => (after !== null && source.has(path)) || (before !== null && old.paths.has(path)),
  );
  if (relevant.length === 0) return old;
  if (relevant.some(({ path }) => manifest(path))) return undefined;
  const added = relevant.filter(({ before, after }) => before === null && after !== null).map(({ path }) => path);
  const removed = new Set(relevant.filter(({ before, after }) => before !== null && after === null).map(({ path }) => path));
  const moved = added.length > 0 || removed.size > 0;
  const dropped = new Set(relevant.flatMap(({ path, before, after }) => touchedNames(path, before === null || after === null)));
  const paths = moved ? old.paths.with(added, removed) : old.paths;
  const units: Units = { paths, members: old.units.members, digests: new Map(), inherited: inheritedOf(old.units, dropped) };
  if (old.units.listed !== undefined) {
    units.listed = moved ? relisted(old.units.listed, added, removed) : old.units.listed;
    if (old.units.children !== undefined)
      units.children = moved ? rechildren(old.units.listed, units.listed, old.units.children, [...added, ...removed]) : old.units.children;
  }
  const snapshot: Snapshot = {
    paths,
    inventory: old.inventory,
    packagePaths: moved ? repackaged(old, added, removed) : old.packagePaths,
    globs: moved ? new Map() : old.globs,
    units,
    size: sizeOf(source),
  };
  if (old.sized !== undefined) snapshot.sized = resized(params, old, snapshot, relevant);
  return snapshot;
}

const INHERITED_DEPTH = 8;

function inheritedOf(units: Units, dropped: ReadonlySet<string>): Inherited {
  const layer: Inherited = { digests: units.digests, dropped, next: units.inherited };
  let depth = 0;
  for (let at: Inherited | undefined = layer; at !== undefined; at = at.next) depth += 1;
  if (depth <= INHERITED_DEPTH) return layer;
  const digests = new Map<string, string>();
  const blocked = new Set<string>();
  for (let at: Inherited | undefined = layer; at !== undefined; at = at.next) {
    for (const name of at.dropped) blocked.add(name);
    for (const [name, digest] of at.digests) if (!blocked.has(name) && !digests.has(name)) digests.set(name, digest);
  }
  return { digests, dropped: new Set() };
}

function repackaged(old: Snapshot, added: readonly string[], removed: ReadonlySet<string>): ReadonlyMap<string, SortedPaths> {
  const owned = new Map<string, { readonly added: string[]; readonly removed: Set<string> }>();
  for (const path of [...added, ...removed]) {
    const name = old.inventory.ownerOf(path)?.name;
    if (name === undefined) continue;
    let held = owned.get(name);
    if (held === undefined) owned.set(name, (held = { added: [], removed: new Set() }));
    if (removed.has(path)) held.removed.add(path);
    else held.added.push(path);
  }
  const changes = new Map<string, SortedPaths | undefined>();
  for (const [name, held] of owned) {
    const next = (old.packagePaths.get(name) ?? SortedPaths.of([])).with(held.added, held.removed);
    changes.set(name, next.size === 0 ? undefined : next);
  }
  return Layered.of(old.packagePaths).with(changes);
}

function relisted(
  listed: ReadonlyMap<string, readonly string[]>,
  added: readonly string[],
  removed: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const dirs = new Map<string, string[]>();
  for (const path of [...added, ...removed]) {
    const dir = parentOf(path);
    const held = dirs.get(dir);
    if (held === undefined) dirs.set(dir, removed.has(path) ? [] : [path]);
    else if (!removed.has(path)) held.push(path);
  }
  const changes = new Map<string, readonly string[] | undefined>();
  for (const [dir, adds] of dirs) {
    const kept = [...(listed.get(dir) ?? []).filter((path) => !removed.has(path)), ...adds].sort();
    changes.set(dir, kept.length === 0 ? undefined : kept);
  }
  return Layered.of(listed).with(changes);
}

function rechildren(
  before: ReadonlyMap<string, readonly string[]>,
  after: ReadonlyMap<string, readonly string[]>,
  children: ReadonlyMap<string, readonly string[]>,
  moved: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const changes = new Map<string, readonly string[] | undefined>();
  const childrenOf = (dir: string): readonly string[] => (changes.has(dir) ? (changes.get(dir) ?? []) : (children.get(dir) ?? []));
  const present = (dir: string): boolean => after.has(dir) || childrenOf(dir).length > 0;
  for (const dir of new Set(moved.map(parentOf))) {
    if (before.has(dir) === after.has(dir)) continue;
    for (let at = dir; at !== ''; at = parentOf(at)) {
      const up = parentOf(at);
      const held = childrenOf(up);
      const standing = present(at);
      if (standing === held.includes(at)) break;
      const next = standing ? [...held, at].sort() : held.filter((one) => one !== at);
      changes.set(up, next.length === 0 ? undefined : next);
    }
  }
  return Layered.of(children).with(changes);
}

const declaredProgram = (params: Of, path: string): boolean =>
  (params.programs ?? []).some((program) => pathOf(params.base, program.at) === path);

const outlying = (params: Of, inventory: Inventory, path: string): boolean =>
  inventory.ownerOf(path) === undefined &&
  (declaredProgram(params, path) ||
    params.apps.some((app) => {
      const at = pathOf(params.base, app.at);
      return inside(path, at) && path !== at && picks(app.files, path.slice(at.length + 1));
    }));

function resized(params: Of, old: Snapshot, next: Snapshot, changes: readonly Change[]): Sizes {
  const sized = old.sized!;
  const packages = new Map(sized.packages);
  let outliers = sized.outliers;
  for (const { path, before, after } of changes) {
    const gone = before === null ? 0 : old.size(path),
      now = after === null ? 0 : next.size(path);
    const files = (after === null ? 0 : 1) - (before === null ? 0 : 1);
    if (outlying(params, old.inventory, path)) {
      const listed = declaredProgram(params, path)
        ? outliers.files
        : after === null
          ? outliers.files.filter((one) => one !== path)
          : before === null
            ? [...outliers.files, path]
            : outliers.files;
      outliers = { files: listed, bytes: outliers.bytes - gone + now };
    }
    if (!js.parses(path)) continue;
    const name = old.inventory.ownerOf(path)?.name;
    if (name === undefined) continue;
    const held = packages.get(name) ?? { files: 0, bytes: 0 };
    packages.set(name, { files: held.files + files, bytes: held.bytes - gone + now });
  }
  return { packages, shared: sized.shared, outliers };
}

export function sizesOf(snapshot: Snapshot, params: Of, source: Tree): Sizes {
  if (snapshot.sized !== undefined) return snapshot.sized;
  const { inventory, paths } = snapshot;
  const packages = new Map<string, Sized>();
  const manifests = new Set([inventory.manifest, ...[...inventory.packages.values()].map(manifestOf)]);
  let shared = { files: 0, bytes: 0 };
  for (const path of paths) {
    const bytes = source.size?.(path) ?? 0;
    if (manifests.has(path)) {
      shared = { files: shared.files + 1, bytes: shared.bytes + bytes };
      continue;
    }
    if (!js.parses(path)) continue;
    const name = inventory.ownerOf(path)?.name;
    if (name === undefined) continue;
    const held = packages.get(name) ?? { files: 0, bytes: 0 };
    packages.set(name, { files: held.files + 1, bytes: held.bytes + bytes });
  }
  const files: string[] = [];
  for (const program of params.programs ?? []) {
    const file = pathOf(params.base, program.at);
    if (inventory.ownerOf(file) === undefined) files.push(file);
  }
  for (const app of params.apps) {
    const at = pathOf(params.base, app.at);
    for (const path of paths.under(at))
      if (inventory.ownerOf(path) === undefined && picks(app.files, path.slice(at.length + 1))) files.push(path);
  }
  snapshot.sized = { packages, shared, outliers: { files, bytes: files.reduce((sum, path) => sum + (source.size?.(path) ?? 0), 0) } };
  return snapshot.sized;
}

export const under = (paths: SortedPaths, root: string): Iterable<string> => paths.under(root);

export const globbed = (snapshot: Snapshot, patterns: readonly string[], spend: (units: number) => void): readonly string[] => {
  const key = JSON.stringify(patterns);
  const held = snapshot.globs.get(key);
  if (held !== undefined) return held;
  const result = globPaths((root) => snapshot.paths.under(root), patterns, spend);
  snapshot.globs.set(key, result);
  return result;
};
