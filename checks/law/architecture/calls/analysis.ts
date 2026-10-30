import type { Finding } from '@runlith/tagma/rules';
import { matcher } from '../../declarations/glob';
import { Registry, type Site } from './file';
import { capable, describe } from './model';
import type { CallParams } from './params';
import { allowed, judgedPaths, productionPaths, type World } from './world';

const SAYS = {
  request: (label: string) => `${label} asks a model outside the doors`,
  ask: (label: string) => `${label} asks an aside outside ThreadAsks`,
  row: (label: string) => `${label} reads a vendor harness row outside its owners`,
} as const;

const FIXES = {
  request:
    'Ask through ModelAsks (text, decide) or ThreadAsks; only providers and the native chat turn call ModelAccess or the requests it returns.',
  ask: 'Ask over the thread through ThreadAsks.over; only threads/asks.ts calls an aside.',
  row: 'Read harness rows only in external-harnesses and threads/harness; ask their owner for what the feature needs.',
} as const;

type SiteGroup = { readonly act: Site['act']; readonly label: string; readonly lines: Set<number> };

const findingsOf = (path: string, sites: readonly Site[], params: CallParams): Finding[] => {
  const groups = new Map<string, SiteGroup>();
  for (const site of sites) {
    if (allowed(site.act, path, params)) continue;
    const key = `${site.act}\0${site.label}`;
    const held = groups.get(key);
    if (held === undefined) groups.set(key, { act: site.act, label: site.label, lines: new Set([site.line]) });
    else held.lines.add(site.line);
  }
  return [...groups.values()].map((one) => {
    const lines = [...one.lines].sort((left, right) => left - right);
    return {
      fingerprint: `ask-call:${one.act}:${path}:${one.label}`,
      path,
      line: lines[0]!,
      message: SAYS[one.act](one.label),
      fix: FIXES[one.act],
      ...(lines.length > 1 ? { sites: lines.map((line) => ({ line })) } : {}),
    };
  });
};

const SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g;

const specifiersOf = (text: string): readonly string[] => {
  const found: string[] = [];
  for (const match of text.matchAll(SPECIFIER)) found.push((match[1] ?? match[2] ?? match[3])!);
  return found;
};

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

const alternativesOf = (path: string): readonly string[] => {
  const stem = path.replace(/\.[cm]?[jt]sx?$/, '');
  const index = /\/index$/.test(stem) ? stem.slice(0, -'/index'.length) : undefined;
  return [
    ...EXTENSIONS.map((one) => `${stem}${one}`),
    ...EXTENSIONS.map((one) => `${stem}/index${one}`),
    ...(index === undefined ? [] : EXTENSIONS.map((one) => `${index}${one}`)),
  ].filter((one) => one !== path);
};

const bearing = (registry: Registry, path: string): boolean => {
  for (const name of registry.names(path))
    for (const space of ['values', 'types'] as const) if (capable(registry.imported(path, name, space))) return true;
  return false;
};

export type Importers = (paths: ReadonlySet<string>) => readonly string[];

type Reach = { readonly judged: readonly string[]; readonly carriers: readonly string[] };

const reach = (
  world: World,
  registry: Registry,
  params: CallParams,
  region: ReadonlySet<string>,
  importers: Importers | undefined,
): Reach => {
  const universe = productionPaths(world.paths);
  const members = new Set(universe);
  const words = [...new Set(params.sources.map((one) => one.name))];
  const mentioned =
    world.mentions?.(words) ??
    new Set(
      universe.filter((path) => {
        const text = world.read(path);
        return text !== undefined && words.some((word) => text.includes(word));
      }),
    );
  const isRow = matcher(params.rows);
  const carriers = new Set<string>([...params.sources.map((one) => one.path), ...world.paths.filter(isRow)]);
  const seen = new Set<string>();
  const queue = universe.filter((path) => mentioned.has(path));
  const specifiers = new Map<string, readonly string[]>();
  let fresh = [...carriers];
  while (queue.length > 0 || fresh.length > 0) {
    const path = queue.pop();
    if (path !== undefined) {
      if (seen.has(path)) continue;
      seen.add(path);
      const model = registry.model(path);
      if (model === undefined) continue;
      if (region.has(path)) model.analyze();
      if (bearing(registry, path)) {
        carriers.add(path);
        fresh.push(path);
      }
      continue;
    }
    const batch = fresh;
    fresh = [];
    if (importers !== undefined) {
      for (const importer of importers(new Set(batch))) if (members.has(importer) && !seen.has(importer)) queue.push(importer);
      continue;
    }
    for (const candidate of universe) {
      if (seen.has(candidate)) continue;
      let known = specifiers.get(candidate);
      if (known === undefined) {
        known = specifiersOf(world.read(candidate) ?? '');
        specifiers.set(candidate, known);
      }
      for (const specifier of known) {
        const target = registry.resolve(specifier, candidate);
        if (target !== null && carriers.has(target)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return { judged: [...seen].filter((path) => region.has(path)), carriers: [...carriers] };
};

export type Analysis = { readonly findings: readonly Finding[]; readonly carriers: readonly string[] };

export const callAnalysis = (
  world: World,
  params: CallParams,
  only?: readonly string[],
  importers?: Importers,
  relevant?: ReadonlySet<string>,
): Analysis => {
  const registry = new Registry(world, params, relevant);
  const region = new Set(judgedPaths(world.paths, params));
  const reached = only === undefined ? reach(world, registry, params, region, importers) : undefined;
  const paths = reached?.judged ?? only!.filter((path) => region.has(path));
  const findings: Finding[] = [];
  for (const path of [...paths].sort()) {
    const model = registry.model(path);
    if (model === undefined) continue;
    model.analyze();
    findings.push(...findingsOf(path, model.sites, params));
  }
  return {
    findings: findings.sort((left, right) =>
      left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1,
    ),
    carriers: reached?.carriers ?? [],
  };
};

export const callFindings = (world: World, params: CallParams, only?: readonly string[], importers?: Importers): readonly Finding[] =>
  callAnalysis(world, params, only, importers).findings;

export const carrying = (world: World, params: CallParams, paths: readonly string[], relevant: ReadonlySet<string>): readonly string[] => {
  const registry = new Registry(world, params, relevant);
  return paths.filter((path) => bearing(registry, path));
};

const summaryOf = (registry: Registry, path: string): string =>
  [...registry.names(path)]
    .sort()
    .map((name) => `${name}=${describe(registry.imported(path, name, 'values'))}|${describe(registry.imported(path, name, 'types'))}`)
    .filter((entry) => !entry.endsWith('=-|-'))
    .join(';');

export const exportSummary = (world: World, params: CallParams, path: string): string => summaryOf(new Registry(world, params), path);

export const callFrontier = (
  before: World,
  after: World,
  params: CallParams,
  changed: readonly string[],
  importersOf: Importers,
  forced: ReadonlySet<string> = new Set(),
  carriers?: ReadonlySet<string>,
): readonly string[] => {
  const reached = new Set(changed);
  const afterRelevant = carriers === undefined ? undefined : new Set([...carriers, ...changed]);
  const registries = { before: new Registry(before, params, carriers), after: new Registry(after, params, afterRelevant) };
  let wave = [...changed];
  const shadows = (path: string): boolean => carriers !== undefined && alternativesOf(path).some((other) => carriers.has(other));
  if (carriers !== undefined) {
    before.prefetch?.([...carriers]);
    after.prefetch?.([...carriers]);
  }
  while (wave.length > 0) {
    before.prefetch?.(wave);
    after.prefetch?.(wave);
    const moved = wave.filter(
      (path) =>
        summaryOf(registries.before, path) !== summaryOf(registries.after, path) ||
        (forced.has(path) && (carriers === undefined || shadows(path))),
    );
    wave = [];
    if (moved.length === 0) break;
    for (const importer of importersOf(new Set(moved)))
      if (!reached.has(importer)) {
        reached.add(importer);
        afterRelevant?.add(importer);
        wave.push(importer);
      }
  }
  return [...reached];
};
