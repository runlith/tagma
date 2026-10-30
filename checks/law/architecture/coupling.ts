import { posix } from 'node:path';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { adapterOf } from '@runlith/code-facts/adapter';
import { sitesOf } from '@runlith/code-facts/tree';
import { exported } from '@runlith/code-facts/js/workspace';
import type { Finding } from '@runlith/tagma/rules';
import type { CouplingMeasure, CouplingParams } from './inspections';
import { moduleOwners, within, type Module, type Snapshot } from './snapshot';
import { packageOf, type Package } from '../declarations/corpus';
import { resolverOf, type Alias } from '../declarations/resolve';
export type Contribution = {
  readonly module: string;
  readonly path: string;
  readonly total: number;
  readonly targets: Readonly<Record<string, number>>;
};
export type Totals = { path: string; files: number; total: number; targets: Record<string, number> };
export type CouplingIndex = {
  readonly revision: string;
  readonly modules: readonly Module[];
  readonly packages: readonly Package[];
  readonly totals: Readonly<Record<string, Totals>>;
};

const packageName = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
const conditions = new Set(['bun', 'node', 'import']);

export const membersOf = (snapshot: Snapshot): readonly Package[] => {
  const packages: Package[] = [];
  for (const path of snapshot.tree.paths!()) {
    if (posix.basename(path) !== 'package.json') continue;
    const member = packageOf(path, snapshot.tree.read(path));
    if (member !== undefined) packages.push(member);
  }
  return packages;
};

export const contributions = (
  snapshot: Snapshot,
  modules: readonly Module[],
  members: readonly Package[],
  aliases: readonly Alias[],
): readonly Contribution[] => {
  const owner = moduleOwners(modules);
  const resolver = resolverOf(
    {
      has: snapshot.tree.has,
      *[Symbol.iterator]() {
        yield* snapshot.tree.paths!();
      },
    },
    members,
    aliases,
  );
  const packages = new Map(members.map((one) => [one.name, one]));
  const entries: Contribution[] = [];
  for (const path of snapshot.paths) {
    if (!within(path, 'apps/tagma/server/src') && !within(path, 'apps/tagma/app/src') && !within(path, 'packages')) continue;
    const from = owner(path);
    if (from === undefined) throw new Error(`${path}: no module card owns this production file`);
    let total = 0;
    const targets: Record<string, number> = Object.create(null);
    for (const site of sitesOf(snapshot.tree, path, ADAPTERS)) {
      if (site.kind === 'unresolved' || site.kind === 'glob') continue;
      total += 1;
      const aliased = aliases.some((one) => site.specifier.startsWith(one.prefix)) ? resolver.resolve(site.specifier, path)[0] : undefined;
      const resolved = aliased === undefined ? adapterOf(ADAPTERS, path).resolve(site.specifier, path, snapshot.tree) : null;
      const name = packageName(site.specifier);
      const member = packages.get(name);
      const subpath = site.specifier === name ? '.' : `.${site.specifier.slice(name.length)}`;
      const entry = member === undefined ? undefined : exported(member.exports, subpath, conditions);
      const target =
        aliased ??
        (resolved !== null
          ? 'to' in resolved
            ? resolved.to
            : resolved.unlisted
          : member === undefined
            ? undefined
            : typeof entry === 'string'
              ? posix.join(member.dir, entry)
              : member.dir);
      const to = target === undefined ? undefined : owner(target);
      const id = to?.id ?? (target === undefined ? name : target);
      if (id !== from.id) targets[id] = (targets[id] ?? 0) + 1;
    }
    entries.push({ module: from.id, path, total, targets });
  }
  return entries;
};

export const applyContributions = (totals: Record<string, Totals>, entries: readonly Contribution[], sign: 1 | -1): void => {
  for (const entry of entries) {
    const held = Object.hasOwn(totals, entry.module)
      ? totals[entry.module]!
      : (totals[entry.module] = { path: entry.path, files: 0, total: 0, targets: Object.create(null) });
    held.files += sign;
    held.total += sign * entry.total;
    for (const [id, count] of Object.entries(entry.targets)) {
      const next = (Object.hasOwn(held.targets, id) ? held.targets[id]! : 0) + sign * count;
      if (next < 0) throw new Error(`${entry.path}: the coupling index lost ${id}'s contribution`);
      if (next === 0) delete held.targets[id];
      else held.targets[id] = next;
    }
    if (sign === 1) held.path = entry.path;
    if (held.files < 0 || held.total < 0) throw new Error(`${entry.path}: the coupling index lost the module contribution`);
    if (held.files === 0) delete totals[entry.module];
  }
};

export const measuresOf = (totals: Readonly<Record<string, Totals>>): readonly CouplingMeasure[] =>
  Object.entries(totals)
    .map(([id, one]) => ({
      id,
      path: one.path,
      modules: Object.keys(one.targets).length,
      outside: Object.values(one.targets).reduce((sum, value) => sum + value, 0),
      total: one.total,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

export const indexCoupling = (snapshot: Snapshot, revision: string, aliases: readonly Alias[]): CouplingIndex => {
  const modules = snapshot.modules;
  const packages = membersOf(snapshot);
  const totals: Record<string, Totals> = Object.create(null);
  applyContributions(totals, contributions(snapshot, modules, packages, aliases), 1);
  return { revision, modules, packages, totals };
};

export const measureCoupling = (snapshot: Snapshot, aliases: readonly Alias[] = []): readonly CouplingMeasure[] =>
  measuresOf(indexCoupling(snapshot, '', aliases).totals);

const share = (one: CouplingMeasure): number => (one.total === 0 ? 0 : one.outside / one.total);
const higherShare = (now: CouplingMeasure, was: CouplingMeasure): boolean =>
  now.outside * Math.max(1, was.total) > was.outside * Math.max(1, now.total);
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 === 0 ? (sorted[at - 1]! + sorted[at]!) / 2 : sorted[at]!;
};

export const couplingFindings = (
  measures: readonly CouplingMeasure[],
  params: CouplingParams,
  previous: readonly CouplingMeasure[] | null,
): readonly Finding[] => {
  const recorded = new Map(params.baseline.map((one) => [one.id, one]));
  const before = new Map(previous?.map((one) => [one.id, one]));
  const typical = { modules: median(params.baseline.map((one) => one.modules)), share: median(params.baseline.map(share)) };
  return measures.flatMap((now): Finding[] => {
    const was = recorded.get(now.id);
    const base = before.get(now.id);
    const prefix = `coupling:${now.id}`;
    const findings: Finding[] = [];
    if (was !== undefined && now.modules > 0)
      findings.push({
        fingerprint: `${prefix}:modules`,
        path: now.path,
        value: now.modules,
        message: `${now.id} imports ${now.modules} other modules`,
        fix: 'Reduce the module’s external dependencies; do not raise its recorded ceiling.',
      });
    if (was !== undefined && now.outside > 0)
      findings.push({
        fingerprint: `${prefix}:share`,
        path: now.path,
        value: share(now),
        message: `${now.id} has ${now.outside}/${now.total} imports leaving its boundary`,
        fix: 'Keep behavior with its owner so fewer imports cross the module boundary.',
      });
    const moduleFinding = (kind: string, ceiling: number): Finding => ({
      fingerprint: `${prefix}:modules-${kind}`,
      path: now.path,
      value: now.modules,
      message: `module fan-out grows to ${now.modules}, above ${ceiling}`,
      fix: 'Remove the added dependency or move the behavior to the module that owns it.',
    });
    const shareFinding = (kind: string, ceiling: number): Finding => ({
      fingerprint: `${prefix}:share-${kind}`,
      path: now.path,
      value: share(now),
      message: `external import share grows to ${now.outside}/${now.total}, above ${ceiling}`,
      fix: 'Reduce cross-boundary imports; removing local imports must not increase the external share.',
    });
    if (now.modules > (was?.modules ?? typical.modules)) findings.push(moduleFinding('ceiling', was?.modules ?? typical.modules));
    if (was === undefined ? share(now) > typical.share : higherShare(now, was))
      findings.push(shareFinding('ceiling', was === undefined ? typical.share : share(was)));
    if (base !== undefined && now.modules > base.modules) findings.push(moduleFinding('increase', base.modules));
    if (base !== undefined && higherShare(now, base)) findings.push(shareFinding('increase', share(base)));
    return findings;
  });
};
