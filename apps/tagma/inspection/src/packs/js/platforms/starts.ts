import { js } from '@runlith/code-facts/adapters';
import { sitesOf, type Tree } from '@runlith/code-facts/tree';
import { EnvelopeExceeded } from '../../../core/node/budget';
import { localOf, picks } from '../../../core/node/select';
import { matchesGlob, posix } from 'node:path';
import type { Violation } from '../../../core/verdict';
import type { Start } from './closure';
import { type Platform, runningOf } from './declaration';
import { declaredDoors, type Door, manifestOf } from './doors';
import { optionOf } from './routes';
import { inside, messageOf, type Of, pathOf, type Snapshot, under } from './snapshot';
import { doorMissingFix, markerFix, named, programMissingFix, UNREADABLE_FIX } from './wording';

export type Root = Start & {
  readonly platform: Platform;
  readonly door?: Door;
  readonly internal: readonly string[];
  readonly manifestEntry?: { readonly manifest: string; readonly entry: string };
};

export type App = Of['apps'][number];

export type AppReading = {
  readonly params: Of;
  readonly tree: Tree;
  readonly snapshot: Snapshot;
  readonly judges: (name: string | undefined) => boolean;
  readonly generated: (file: string) => boolean;
};

export const routedOf = (params: Of, app: App): string | undefined =>
  app.routes === undefined ? undefined : pathOf(pathOf(params.base, app.at), app.routes.at);

export function appStarts(app: App, reading: AppReading): { readonly at: string; readonly startsOf: (file: string) => Root[] } {
  const { params, tree, snapshot, judges, generated } = reading;
  const {
    paths,
    inventory: { ownerOf },
  } = snapshot;
  const at = pathOf(params.base, app.at);
  const rendering = params.rendering!;
  const routes = app.routes;
  const routed = routedOf(params, app);
  const matches = (globs: readonly string[] | undefined, file: string): boolean =>
    (globs ?? []).some((glob) => matchesGlob(file.slice(at.length + 1), glob));
  const options = new Map<string, boolean | undefined>();
  const decided = (dir: string, names: readonly string[]): boolean | undefined => {
    let value: boolean | undefined;
    for (const name of names) {
      const file = posix.join(dir, name);
      if (!options.has(file)) options.set(file, optionOf(tree, file, routes!.option!.export, routes!.option!.off));
      value = options.get(file) ?? value;
    }
    return value;
  };
  const layouts = new Map<string, boolean>();
  const inherited = (dir: string): boolean => {
    const held = layouts.get(dir);
    if (held !== undefined) return held;
    const enabled =
      decided(dir, routes!.option?.layouts ?? []) ?? (inside(dir, routed!) && dir !== routed ? inherited(posix.dirname(dir)) : true);
    layouts.set(dir, enabled);
    return enabled;
  };
  const active = (file: string): boolean => {
    const dir = posix.dirname(file);
    return routes!.option === undefined ? true : (decided(dir, routes!.option.pages) ?? inherited(dir));
  };
  let wrapped: ReadonlySet<string> | undefined;
  const wrapping = (): ReadonlySet<string> => {
    if (wrapped !== undefined) return wrapped;
    const dirs = new Set<string>();
    for (const file of routes === undefined ? [] : under(paths, routed!)) {
      if (!routes!.pages.includes(posix.basename(file)) || !active(file)) continue;
      for (let dir = posix.dirname(file); !dirs.has(dir) && inside(dir, routed!); dir = posix.dirname(dir)) {
        dirs.add(dir);
        if (dir === routed) break;
      }
    }
    return (wrapped = dirs);
  };
  const startsOf = (file: string): Root[] => {
    const owner = ownerOf(file);
    if (!judges(owner?.name) || generated(file) || !picks(app.files, file.slice(at.length + 1))) return [];
    const root = { id: file, file, internal: app.internal, package: owner?.name };
    const name = posix.basename(file);
    const server = matches(app.server, file);
    const found: Root[] = [];
    if (app.roots.some((dir) => inside(file, pathOf(at, dir))) && !server) found.push({ ...root, platform: rendering.client });
    const routing = routes !== undefined && inside(file, routed!);
    const universal =
      routing && (routes.pages.includes(name) ? active(file) : routes.layouts.includes(name) && wrapping().has(posix.dirname(file)));
    if (server || universal || matches(app.ssr, file)) found.push({ ...root, platform: rendering.server });
    return found;
  };
  return { at, startsOf };
}

export const markerViolation = (door: Door, marker: string): Violation => ({
  fingerprint: `${door.id} [${door.platform}] marker`,
  file: door.manifest,
  line: 1,
  specifier: door.entry,
  message: marker,
  fix: markerFix(door),
  chain: [],
});

export function declaredStart(params: Of, tree: Tree, root: Root): { readonly violations: readonly Violation[]; readonly walks: boolean } {
  const { door, manifestEntry } = root;
  const marked = door?.marker === undefined ? [] : [markerViolation(door, door.marker)];
  if (door !== undefined && (door.file === undefined || !tree.has(door.file))) {
    if (params.compiled.includes(door.package)) return { violations: marked, walks: false };
    const missing: Violation = {
      fingerprint: `${door.id} [${root.platform}] -> unresolved ${door.entry} @ ${door.manifest}`,
      file: door.manifest,
      line: 1,
      specifier: door.entry,
      chain: [],
      message: 'The declared door resolves to no file',
      fix: doorMissingFix(door),
    };
    return { violations: [...marked, missing], walks: false };
  }
  if (manifestEntry === undefined || tree.has(root.file)) return { violations: marked, walks: true };
  if (root.package !== undefined && params.compiled.includes(root.package)) return { violations: marked, walks: false };
  const missing: Violation = {
    fingerprint: `${root.id} [${root.platform}] -> unresolved ${manifestEntry.entry} @ ${manifestEntry.manifest}`,
    file: manifestEntry.manifest,
    line: 1,
    specifier: manifestEntry.entry,
    chain: [],
    message: 'The declared program resolves to no file',
    fix: programMissingFix(manifestEntry.entry, manifestEntry.manifest, root.package),
  };
  return { violations: [...marked, missing], walks: false };
}

export const doorRoot = (door: Door): Root => ({
  id: door.key,
  label: door.id,
  file: door.file ?? door.manifest,
  package: door.package,
  platform: door.platform,
  door,
  internal: [],
});

function memberStarts(params: Of, snapshot: Snapshot, source: Tree, name: string): Root[] {
  const {
    packagePaths,
    inventory: { packages },
  } = snapshot;
  const member = packages.get(name)!;
  const found: Root[] = [];
  if (params.base !== '' && !inside(member.dir, params.base) && !inside(params.base, member.dir)) return found;
  for (const door of declaredDoors(
    name,
    member,
    [...(packagePaths.get(name) ?? [])].filter((path) => {
      const local = localOf(params.base, path);
      return local !== undefined && picks(params.files, local);
    }),
    runningOf(params),
  )) {
    const file = door.file;
    if (file !== undefined && (localOf(params.base, file) === undefined || params.leaves.some((suffix) => file.endsWith(suffix)))) continue;
    found.push(doorRoot(door));
  }
  const manifest = member.manifest;
  const bin = manifest.bin;
  const entries: { entry: unknown; kind: string }[] = [
    { entry: manifest.main, kind: 'main' },
    ...(typeof bin === 'string'
      ? [{ entry: bin, kind: 'bin' }]
      : bin !== null && typeof bin === 'object' && !Array.isArray(bin)
        ? Object.entries(bin).map(([key, entry]) => ({ entry, kind: `bin/${key}` }))
        : []),
  ];
  for (const { entry, kind } of entries) {
    if (typeof entry !== 'string') continue;
    const file = pathOf(member.dir, entry);
    const local = localOf(params.base, file);
    if (local === undefined || !picks(params.files, local)) continue;
    if (!source.has(file) && (params.programs ?? []).some((program) => pathOf(params.base, program.replaces ?? '') === file)) continue;
    found.push({
      id: `${name}#${kind}`,
      file,
      platform: params.shipped,
      package: name,
      internal: [],
      manifestEntry: { manifest: manifestOf(member), entry },
    });
  }
  return found;
}

function programStarts(params: Of, snapshot: Snapshot, judges: (name: string | undefined) => boolean): Root[] {
  const found: Root[] = [];
  for (const program of params.programs ?? []) {
    const file = pathOf(params.base, program.at);
    const owner = snapshot.inventory.ownerOf(file);
    if (judges(owner?.name)) found.push({ id: file, file, platform: program.platform, internal: [], package: owner?.name });
  }
  return found;
}

export function packageStarts(params: Of, snapshot: Snapshot, source: Tree, judges: (name: string | undefined) => boolean): Root[] {
  const found: Root[] = [];
  for (const name of snapshot.inventory.packages.keys()) if (judges(name)) found.push(...memberStarts(params, snapshot, source, name));
  return [...found, ...programStarts(params, snapshot, judges)];
}

export const packageStarted = (
  params: Of,
  snapshot: Snapshot,
  source: Tree,
  platform: Platform,
  enumerated: Set<string>,
  reused: Iterable<string | null>,
) => {
  const pending = new Set(reused);
  for (const root of programStarts(params, snapshot, (name) => pending.has(name ?? null)))
    if (root.platform === platform) enumerated.add(root.id);
  return (id: string, file: string): boolean => {
    const owner = snapshot.inventory.ownerOf(file)?.name;
    if (owner !== undefined && pending.delete(owner))
      for (const root of memberStarts(params, snapshot, source, owner)) if (root.platform === platform) enumerated.add(root.id);
    return enumerated.has(id);
  };
};

export function nameViolations(tree: Tree, file: string, owner: string, refused: (specifier: string) => string | undefined): Violation[] {
  const violations: Violation[] = [];
  try {
    for (const site of sitesOf(tree, file, [js])) {
      if (site.kind !== undefined) continue;
      const entry = refused(site.specifier);
      if (entry !== undefined)
        violations.push({
          fingerprint: `${file} -> ${entry} (names)`,
          file,
          line: site.line,
          specifier: site.specifier,
          chain: [site.specifier],
          ...named(site.specifier, owner),
        });
    }
  } catch (error) {
    if (error instanceof EnvelopeExceeded) throw error;
    violations.push({
      fingerprint: `${file} -> unresolved ${file} @ ${file}`,
      file,
      line: 1,
      specifier: file,
      message: messageOf(error),
      fix: UNREADABLE_FIX,
    });
  }
  return violations;
}
