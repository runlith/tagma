import type { Tree } from '@runlith/code-facts/tree';
import type { Part, Plan, Planned } from '../../../core/node/slices';
import type { Envelope } from '../../../core/rule';
import { covered, type Of, type Snapshot, sizesOf, snapshotOf } from './snapshot';

const MIB = 1024 * 1024;

export function planSlices(params: Of, source: Tree, places: readonly string[], envelope: Envelope, prepared?: Snapshot): Plan {
  let snapshot: Snapshot;
  try {
    snapshot = prepared ?? snapshotOf(params, source);
  } catch {
    return { slices: [{ parts: [{ package: null, judged: true }], files: 0, bytes: 0 }], envelope, headroom: 0 };
  }
  const { inventory } = snapshot;
  const { packages: size, shared, outliers } = sizesOf(snapshot, params, source);
  const names = [...inventory.packages.keys()].sort();
  const dependsOn = new Map(
    names.map((name) => {
      const manifest = inventory.packages.get(name)!.manifest;
      const declared = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) => {
        const value = manifest[field];
        return value !== null && typeof value === 'object' ? Object.keys(value) : [];
      });
      return [name, [...new Set(declared)].filter((one) => one !== name && inventory.packages.has(one)).sort()];
    }),
  );
  const groups: string[][] = [];
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    onStack = new Set<string>();
  const visit = (name: string): void => {
    index.set(name, index.size);
    low.set(name, index.get(name)!);
    stack.push(name);
    onStack.add(name);
    for (const next of dependsOn.get(name)!) {
      if (!index.has(next)) {
        visit(next);
        low.set(name, Math.min(low.get(name)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(name, Math.min(low.get(name)!, index.get(next)!));
    }
    if (low.get(name) !== index.get(name)) return;
    const group: string[] = [];
    for (let top = stack.pop()!; ; top = stack.pop()!) {
      onStack.delete(top);
      group.push(top);
      if (top === name) break;
    }
    groups.push(group.sort());
  };
  for (const name of names) if (!index.has(name)) visit(name);
  const capacity = { files: envelope.files - shared.files, bytes: envelope.mib * MIB - shared.bytes };
  let headroom = capacity.bytes;
  const slices: Planned[] = [];
  const open = new Map<boolean, Planned>();
  const place = (parts: readonly Part[], files: number, bytes: number, judged: boolean): void => {
    const held = open.get(judged);
    if (held !== undefined && held.files + files <= capacity.files && held.bytes + bytes <= capacity.bytes) {
      const grown = { parts: [...held.parts, ...parts], files: held.files + files, bytes: held.bytes + bytes };
      slices[slices.indexOf(held)] = grown;
      open.set(judged, grown);
      return;
    }
    const fresh = { parts, files, bytes };
    slices.push(fresh);
    open.set(judged, fresh);
  };
  for (const group of groups) {
    const parts = group.map((name) => ({ package: name, judged: covered(places, inventory.packages.get(name)!.dir) }));
    const files = group.reduce((sum, name) => sum + (size.get(name)?.files ?? 0), 0);
    const bytes = group.reduce((sum, name) => sum + (size.get(name)?.bytes ?? 0), 0);
    if (shared.files + files > envelope.files || shared.bytes + bytes > envelope.mib * MIB)
      throw new Error(`platforms: indivisible package group ${group.join(', ')} exceeds its per-slice source envelope`);
    headroom = Math.min(headroom, capacity.bytes - bytes);
    place(
      parts,
      files,
      bytes,
      parts.some(({ judged }) => judged),
    );
  }
  if (outliers.files.length > 0) {
    if (shared.files + outliers.files.length > envelope.files || shared.bytes + outliers.bytes > envelope.mib * MIB)
      throw new Error('platforms: files outside packages exceed their per-slice source envelope');
    headroom = Math.min(headroom, capacity.bytes - outliers.bytes);
    const judged = outliers.files.some((path) => covered(places, path));
    place([{ package: null, judged }], outliers.files.length, outliers.bytes, judged);
  }
  return { slices, envelope, headroom };
}
