import type { Finding } from '@runlith/tagma/rules';
import { matcher } from '../../declarations/glob';
import { Registry, type Site } from './file';
import { capable, describe } from './model';
import type { CallParams } from './params';
import { allowed, judgedPaths, type World } from './world';

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

const findingsOf = (path: string, sites: readonly Site[], params: CallParams): Finding[] => {
  const groups = new Map<string, { readonly act: Site['act']; readonly label: string; readonly lines: Set<number> }>();
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

const tail = (value: string): string => value.slice(value.lastIndexOf('/') + 1).replace(/\.[cm]?[jt]sx?$/, '');

const stemsOf = (path: string): readonly string[] => {
  const name = tail(path);
  return name === 'index' && path.includes('/') ? [name, tail(path.slice(0, path.lastIndexOf('/')))] : [name];
};

const bearing = (registry: Registry, path: string): boolean => {
  for (const name of registry.names(path))
    for (const space of ['values', 'types'] as const) if (capable(registry.imported(path, name, space))) return true;
  return false;
};

const reach = (world: World, registry: Registry, params: CallParams, region: ReadonlySet<string>): readonly string[] => {
  const words = [...new Set(params.sources.map((one) => one.name))];
  const mentioned =
    world.mentions?.(words) ??
    new Set(
      [...region].filter((path) => {
        const text = world.read(path);
        return text !== undefined && words.some((word) => text.includes(word));
      }),
    );
  const isRow = matcher(params.rows);
  const carriers = new Set<string>([...params.sources.map((one) => one.path), ...world.paths.filter(isRow)]);
  const judged = new Set<string>();
  const queue = [...region].filter((path) => mentioned.has(path));
  const specifiers = new Map<string, readonly string[]>();
  let fresh = [...carriers];
  while (queue.length > 0 || fresh.length > 0) {
    const path = queue.pop();
    if (path !== undefined) {
      if (judged.has(path)) continue;
      judged.add(path);
      registry.model(path)?.analyze();
      if (bearing(registry, path)) {
        carriers.add(path);
        fresh.push(path);
      }
      continue;
    }
    const stems = new Set(fresh.flatMap(stemsOf));
    fresh = [];
    for (const candidate of region) {
      if (judged.has(candidate) || queue.includes(candidate)) continue;
      let known = specifiers.get(candidate);
      if (known === undefined) {
        known = specifiersOf(world.read(candidate) ?? '');
        specifiers.set(candidate, known);
      }
      for (const specifier of known) {
        if (!stems.has(tail(specifier))) continue;
        const target = registry.resolve(specifier, candidate);
        if (target !== null && carriers.has(target)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...judged];
};

export const callFindings = (world: World, params: CallParams, only?: readonly string[]): readonly Finding[] => {
  const registry = new Registry(world, params);
  const region = new Set(judgedPaths(world.paths, params));
  const paths = only === undefined ? reach(world, registry, params, region) : only.filter((path) => region.has(path));
  const findings: Finding[] = [];
  for (const path of [...paths].sort()) {
    const model = registry.model(path);
    if (model === undefined) continue;
    model.analyze();
    findings.push(...findingsOf(path, model.sites, params));
  }
  return findings.sort((left, right) =>
    left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1,
  );
};

const summaryOf = (registry: Registry, path: string): string =>
  [...registry.names(path)]
    .sort()
    .map((name) => `${name}=${describe(registry.imported(path, name, 'values'))}|${describe(registry.imported(path, name, 'types'))}`)
    .join(';');

export const exportSummary = (world: World, params: CallParams, path: string): string => summaryOf(new Registry(world, params), path);

export const callFrontier = (
  before: World,
  after: World,
  params: CallParams,
  changed: readonly string[],
  importersOf: (path: string) => readonly string[],
): readonly string[] => {
  const registries = { before: new Registry(before, params), after: new Registry(after, params) };
  const reached = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (summaryOf(registries.before, path) === summaryOf(registries.after, path)) continue;
    for (const importer of importersOf(path)) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      queue.push(importer);
    }
  }
  return [...reached];
};
