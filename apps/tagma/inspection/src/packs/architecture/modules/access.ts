import { contextDigest } from '@runlith/code-facts/adapter';
import { localEntry, type ModuleMap } from '../../../core/rule';
import { bare } from '../../../core/params';
import { boundariesFor, type Run } from './declaration';

export type AccessTarget = { readonly at: string; readonly owner: string; readonly consumers: readonly string[] };

export type AccessDelta = {
  readonly targets: readonly AccessTarget[];
  readonly sources: readonly string[];
};

export const accessDelta = (before: Run, after: Run): AccessDelta | undefined => {
  const { map: _beforeMap, ...beforePolicy } = before;
  const { map: _afterMap, ...afterPolicy } = after;
  if (contextDigest(beforePolicy) !== contextDigest(afterPolicy)) return undefined;
  const structure = (map: ModuleMap) =>
    JSON.stringify({
      region: map.region,
      modules: map.modules.map(({ id, territory, order }) => ({ id, territory, order })),
    });
  if (structure(before.map) !== structure(after.map)) return undefined;
  const was = boundariesFor(before);
  const now = boundariesFor(after);
  const previous = new Map(before.map.modules.map((one) => [one.id, one]));
  const targets: AccessTarget[] = [];
  const sources = new Set<string>();
  const pairs = (map: ModuleMap) => new Map(map.relations.map(({ from, to, role }) => [`${from}\0${to}`, role ?? 'open']));
  const left = pairs(before.map);
  const right = pairs(after.map);
  const changed = new Set<string>();
  for (const key of new Set([...left.keys(), ...right.keys()]))
    if (left.get(key) !== right.get(key)) changed.add(key.slice(key.indexOf('\0') + 1));
  for (const module of after.map.modules) {
    const prior = previous.get(module.id)!;
    const entriesChanged = JSON.stringify(prior.entries) !== JSON.stringify(module.entries);
    if (!entriesChanged && !changed.has(module.id)) continue;
    const points = new Set([
      ...module.territory,
      ...(prior.entries ?? []).map(({ at }) => at),
      ...(module.entries ?? []).map(({ at }) => at),
    ]);
    for (const written of points) {
      const projected = localEntry(before.base, written);
      if (projected === undefined) continue;
      const local = bare(projected);
      const path = before.base === '' ? local : local === '' ? before.base : `${before.base}/${local}`;
      if (was.ownerOf(local) !== module.id) continue;
      if (entriesChanged && was.isTest(local) && !now.isTest(local)) sources.add(path);
      const consumers = after.map.modules
        .filter(({ id }) =>
          [false, true].some((test) =>
            [false, true].some(
              (typeOnly) => was.reaches(id, module.id, local, { test, typeOnly }) && !now.reaches(id, module.id, local, { test, typeOnly }),
            ),
          ),
        )
        .map(({ id }) => id);
      if (consumers.length > 0) targets.push({ at: path, owner: module.id, consumers });
    }
  }
  return { targets: [...targets], sources: [...sources] };
};

export const ledgerPaths = (params: Run, fingerprints: readonly string[], has: (path: string) => boolean): readonly string[] => {
  const paths = new Set<string>();
  for (const fingerprint of fingerprints) {
    const order = /^\S+ order /u.exec(fingerprint);
    const marker = order === null ? ' @ ' : ' -> ';
    let found = false;
    for (let at = fingerprint.indexOf(marker); at !== -1; at = fingerprint.indexOf(marker, at + marker.length)) {
      found = true;
      const local = order === null ? fingerprint.slice(at + marker.length) : fingerprint.slice(order[0].length, at);
      const path = params.base === '' ? local : `${params.base}/${local}`;
      if (has(path)) paths.add(path);
    }
    if (!found) throw new Error(`modules fingerprint has no source path: ${fingerprint}`);
  }
  return [...paths];
};
