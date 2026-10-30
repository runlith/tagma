import { posix } from 'node:path';
import { changesBetween, FAR, GOOD_ENOUGH } from '../declarations/index';
import { blobTexts } from '../git';
import { derivedMap, recentRoots, rootAt, seededMap, valueAt } from '../maps';
import { versionAt } from './cache';
import { moduleAt, type Module } from './snapshot';

export type Boundaries = {
  readonly owner: (path: string) => string | undefined;
  readonly imports: (from: string, to: string) => boolean;
};

type Territory = readonly (readonly [card: string, id: string])[];
type State = Boundaries & {
  readonly card: (path: string) => Module | undefined;
  readonly module: (id: string) => Module | undefined;
  readonly dependents: (id: string) => readonly string[];
};
const keysOf = (module: Module): readonly string[] =>
  module.paths.map((one) => `${one.kind === 'file' ? 'tf' : 'td'}:${one.ref.replace(/\/$/, '')}`);
const ordered = (rows: Territory): Territory => [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

export const boundaryState = (root: string, revision: string, modules?: readonly Module[]): State => {
  const family = `boundaries:${versionAt(root, revision)}`;
  const view = (id: string): State => {
    const owners = new Map<string, string | undefined>();
    const owner = (path: string): string | undefined => {
      if (owners.has(path)) return owners.get(path);
      const pick = (key: string): string | undefined => {
        const rows = valueAt(root, id, key) as Territory | undefined;
        return rows?.[rows.length - 1]?.[1];
      };
      let found = pick(`tf:${path}`);
      for (let at = path; found === undefined && at !== '.'; at = posix.dirname(at)) found = pick(`td:${at}`);
      found ??= pick('td:.');
      owners.set(path, found);
      return found;
    };
    return {
      owner,
      card: (path) => valueAt(root, id, `c:${path}`) as Module | undefined,
      module: (name) => valueAt(root, id, `m:${name}`) as Module | undefined,
      dependents: (name) => {
        const node = (valueAt(root, id, `m:${name}`) as Module | undefined)?.node;
        return node === undefined ? [] : ((valueAt(root, id, `r:${node}`) as readonly string[] | undefined) ?? []);
      },
      imports: (from, to) =>
        ((valueAt(root, id, `m:${from}`) as Module | undefined)?.imports ?? []).some((node) => valueAt(root, id, `n:${node}`) === to),
    };
  };
  if (modules !== undefined) {
    const territories = new Map<string, [string, string][]>();
    const rows: (readonly [string, unknown])[] = [];
    const reverse = new Map<string, string[]>();
    for (const module of modules) {
      for (const node of module.imports ?? []) reverse.set(node, [...(reverse.get(node) ?? []), module.id]);
      rows.push([`m:${module.id}`, module]);
      if (module.card !== undefined) rows.push([`c:${module.card}`, module]);
      if (module.node !== undefined) rows.push([`n:${module.node}`, module.id]);
      for (const key of keysOf(module)) territories.set(key, [...(territories.get(key) ?? []), [module.card ?? '', module.id]]);
    }
    for (const [key, held] of territories) rows.push([key, ordered(held)]);
    for (const [node, ids] of reverse) rows.push([`r:${node}`, ids.sort()]);
    return view(seededMap(root, family, revision, rows));
  }
  const held = rootAt(root, family, revision);
  if (held !== undefined) return view(held);
  let best: { revision: string; id: string; changes: ReturnType<typeof changesBetween> } | undefined;
  for (const one of recentRoots(root, family, 6)) {
    const changes = changesBetween(root, one.revision, revision);
    if (best === undefined || changes.length < best.changes.length) best = { ...one, changes };
    if (changes.length < GOOD_ENOUGH) break;
  }
  if (best === undefined || best.changes.length > FAR)
    throw new Error('module boundaries have no revision index; run check_rules over all to remeasure before judging a change');
  const cards = best.changes.filter((one) => one.path.startsWith('.tagma/') && one.path.endsWith('.md'));
  const texts = blobTexts(
    root,
    cards.flatMap((one) => (one.after === null ? [] : [one.after])),
  );
  const overlay = new Map<string, unknown>();
  const read = (key: string): unknown => (overlay.has(key) ? overlay.get(key) : valueAt(root, best!.id, key));
  for (const change of cards) {
    const before = read(`c:${change.path}`) as Module | undefined;
    const after = change.after === null ? undefined : moduleAt(change.path, texts.get(change.after)!);
    overlay.set(`c:${change.path}`, after);
    for (const [module, add] of [
      [before, false],
      [after, true],
    ] as const) {
      if (module === undefined) continue;
      overlay.set(`m:${module.id}`, add ? module : undefined);
      if (module.node !== undefined) overlay.set(`n:${module.node}`, add ? module.id : undefined);
      for (const node of module.imports ?? []) {
        const ids = ((read(`r:${node}`) as readonly string[] | undefined) ?? []).filter((id) => id !== module.id);
        if (add) ids.push(module.id);
        overlay.set(`r:${node}`, ids.length === 0 ? undefined : ids.sort());
      }
      for (const key of keysOf(module)) {
        const rows = ((read(key) as Territory | undefined) ?? []).filter((one) => one[0] !== change.path);
        if (add) rows.push([change.path, module.id]);
        overlay.set(key, rows.length === 0 ? undefined : ordered(rows));
      }
    }
  }
  return view(derivedMap(root, family, revision, best.id, overlay));
};
