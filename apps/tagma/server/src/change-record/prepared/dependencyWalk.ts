import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { totalmem } from 'node:os';
import { contentDigest } from '@runlith/files/content';
import { textChanges } from '@runlith/utils/patch';
import { blobTree, type ParseMemo } from '@runlith/code-facts/blobs';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Resolution, SymbolImport, SymbolMeaning, SymbolReader, Symbols } from '@runlith/code-facts/adapter';
import type { Tree } from '@runlith/code-facts/tree';
import { UnsupportedSource } from '@runlith/code-facts/imports';

export type Dependency = { readonly path: string; readonly name: string; readonly line: number };
export type ImportedUse = { readonly path: string; readonly name: string; readonly meaning: SymbolMeaning };
export type BoundTexts = { readonly working: Symbols; readonly landed: Symbols; readonly candidates: readonly Dependency[] };
export type DependencyInput = {
  readonly root: string;
  readonly path: string;
  readonly working: string;
  readonly head: string | null;
  readonly lands: boolean;
  readonly uses?: readonly ImportedUse[];
  readonly facts?: BoundTexts;
};
export type DependencyProbe = { readonly root: string; readonly path: string; readonly capture: number };
export type ImportProbe = {
  readonly text: string | undefined;
  readonly paths: readonly string[];
  readonly reads: number;
  readonly importMs: number;
};
export type PlacementInput = {
  readonly root: string;
  readonly path: string;
  readonly text: string;
  readonly lines?: readonly number[];
  readonly names: readonly string[];
  readonly files: readonly string[];
  readonly texts: readonly (readonly [string, string | null])[];
  readonly capture: number;
};
export type DependencyAnswer = {
  readonly dependencies: readonly Dependency[];
  readonly imports: readonly ImportedUse[];
  readonly facts: BoundTexts | undefined;
  readonly lines: readonly number[] | undefined;
  readonly parses: number;
};

const EMPTY: Symbols = { references: [], exports: [], forwards: [], names: [], uses: [], imports: [] };
type ImportFacts = { readonly digest: string; readonly memo: ParseMemo; readonly bytes: number };
const importsByPath = new Map<string, ImportFacts>();
const importBudget = Math.floor(totalmem() / 4096);
let importBytes = 0;

const treeAt = (root: string): Tree => ({
  has: (path) => {
    try {
      return statSync(join(root, path)).isFile();
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
        return false;
      throw error;
    }
  },
  read: (path) => readFileSync(join(root, path), 'utf8'),
  realpath: (path) => relative(root, realpathSync(join(root, path))).replaceAll('\\', '/'),
});

const changedLines = (head: string | null, working: string): readonly number[] | undefined => {
  if (head === null) return undefined;
  const changed = textChanges(head, working);
  if (changed.timedOut) return undefined;
  const lines: number[] = [];
  for (const { after } of changed.changes) for (let at = after.start; at < after.end; at += 1) lines.push(at + 1);
  return lines;
};

export const dependencyImportsOf = async (input: DependencyProbe): Promise<ImportProbe> => {
  const adapter = ADAPTERS.find((one) => one.parses(input.path));
  if (adapter === undefined) return { text: undefined, paths: [], reads: 0, importMs: 0 };
  const path = join(input.root, input.path);
  if (!treeAt(input.root).has(input.path)) return { text: undefined, paths: [], reads: 0, importMs: 0 };
  if (statSync(path).size > input.capture) throw new Error(`${input.path} exceeds its dependency text capture`);
  const text = readFileSync(path, 'utf8');
  const key = `${input.root}\0${input.path}`;
  const digest = contentDigest(text);
  const previous = importsByPath.get(key);
  const hit = previous?.digest === digest;
  if (previous !== undefined) {
    importsByPath.delete(key);
    importBytes -= previous.bytes;
  }
  const memo = hit ? previous.memo : new Map();
  const parsed = blobTree(new Map([[input.path, digest]]), new Map([[digest, text]]), memo, ADAPTERS);
  const started = performance.now();
  const sites = parsed.sites!(input.path);
  const importMs = performance.now() - started;
  const bytes =
    key.length * 2 +
    digest.length * 2 +
    256 +
    sites.reduce(
      (total, site) =>
        total + 512 + site.specifier.length * 2 + (site.patterns ?? []).reduce((size, pattern) => size + 16 + pattern.length * 2, 0),
      0,
    );
  if (bytes <= importBudget) {
    while (importBytes + bytes > importBudget) {
      const oldest = importsByPath.keys().next().value;
      if (oldest === undefined) break;
      importBytes -= importsByPath.get(oldest)!.bytes;
      importsByPath.delete(oldest);
    }
    importsByPath.set(key, { digest, memo, bytes });
    importBytes += bytes;
  }
  const tree = treeAt(input.root);
  const paths = new Set<string>();
  let reader: SymbolReader | undefined;
  for (const site of sites) {
    const target = await resolvedOrNull(async () => {
      const direct = adapter.resolve(site.specifier, input.path, tree);
      if (direct !== null && 'to' in direct) return direct;
      return adapter.symbols === undefined ? null : (reader ??= await adapter.symbols()).resolve(site.specifier, input.path, tree);
    }, tree);
    if (target !== null && target !== '..' && !target.startsWith('../')) paths.add(target);
  }
  return { text, paths: [...paths], reads: hit ? 0 : 1, importMs };
};

const resolvedOrNull = async (resolve: () => Promise<Resolution | null>, tree: Tree): Promise<string | null> => {
  try {
    const resolved = await resolve();
    return resolved === null || !('to' in resolved) ? null : tree.realpath!(resolved.to);
  } catch (error) {
    if (error instanceof UnsupportedSource) return null;
    throw error;
  }
};

export const placementsOf = async (input: PlacementInput): Promise<readonly string[]> => {
  const adapter = ADAPTERS.find((one) => one.parses(input.path));
  if (adapter?.symbols === undefined) return [];
  const reader = await adapter.symbols();
  const disk = treeAt(input.root);
  const texts = new Map(input.texts);
  const tree: Tree = {
    has: (path) => (texts.has(path) ? texts.get(path) !== null : disk.has(path)),
    read: (path) => texts.get(path) ?? disk.read(path),
    size: (path) => (texts.has(path) ? texts.get(path)?.length : !disk.has(path) ? undefined : statSync(join(input.root, path)).size),
    realpath: disk.realpath,
  };
  let left = input.capture - input.text.length;
  const files: string[] = [];
  for (const path of input.files) {
    if (!adapter.parses(path) || !tree.has(path)) continue;
    const size = texts.get(path)?.length ?? statSync(join(input.root, path)).size;
    if (size > left) continue;
    left -= size;
    files.push(path);
  }
  return reader.place({ text: input.text, path: input.path, lines: input.lines, names: input.names, files, tree, capture: left });
};

export const dependenciesOf = async (input: DependencyInput): Promise<DependencyAnswer> => {
  const adapter = ADAPTERS.find((one) => one.parses(input.path));
  if (adapter?.symbols === undefined) return { dependencies: [], imports: [], facts: undefined, lines: undefined, parses: 0 };
  const reader = await adapter.symbols();
  let parses = 0;
  const read = (text: string, lines?: readonly number[]): Symbols => {
    parses += 1;
    return reader.read(text, input.path, lines);
  };
  const lines = changedLines(input.head, input.working);
  const working = input.facts?.working ?? read(input.working);
  const landed =
    input.facts?.landed ??
    (input.lands ? (lines === undefined ? working : read(input.working, lines)) : input.head === null ? EMPTY : read(input.head));
  const changed = new Set(input.lands ? [] : (lines ?? working.names.map((one) => one.line)));
  if (!input.lands && input.head === null) changed.add(0);
  const keptNames = new Set(landed.names.map((one) => `${one.owner}\0${one.name}`));
  const candidates =
    input.facts?.candidates ??
    working.names.flatMap((one): Dependency[] =>
      !changed.has(one.line) || keptNames.has(`${one.owner}\0${one.name}`) ? [] : [{ path: input.path, name: one.name, line: one.line }],
    );
  const dependencies: Dependency[] = [];
  const imports = new Map<string, ImportedUse>();
  const tree = treeAt(input.root);
  const resolutions = new Map<string, string | null>();
  const follow = (imported: SymbolImport): void => {
    let path = resolutions.get(imported.from);
    if (path === undefined) {
      try {
        const resolved = reader.resolve(imported.from, input.path, tree);
        path = resolved !== null && 'to' in resolved ? tree.realpath!(resolved.to) : null;
      } catch (error) {
        if (!(error instanceof UnsupportedSource)) throw error;
        path = null;
      }
      resolutions.set(imported.from, path);
    }
    if (path === null || path.startsWith('../') || path === '..') return;
    const one = { path, name: imported.name, meaning: imported.meaning };
    imports.set(`${path}\0${one.name}\0${one.meaning}`, one);
  };
  const note = (name: string, line: number): void => {
    if (changed.has(line)) dependencies.push({ path: input.path, name, line });
  };
  if (input.uses !== undefined) {
    const landedExports = new Map(landed.exports.map((one) => [one.name, one]));
    const workingExports = new Map(working.exports.map((one) => [one.name, one]));
    const lookup = (exports: typeof landedExports, name: string) => {
      const direct = exports.get(name);
      if (direct !== undefined) return { exported: direct, suffix: '' };
      const parts = name.split('.');
      for (let end = parts.length - 1; end > 0; end -= 1) {
        const prefix = exports.get(parts.slice(0, end).join('.'));
        if (prefix?.imported !== undefined) return { exported: prefix, suffix: parts.slice(end).join('.') };
      }
      return undefined;
    };
    const forward = (found: NonNullable<ReturnType<typeof lookup>>, meaning: SymbolMeaning) => {
      const imported = found.exported.imported!;
      const name = found.suffix === '' ? imported.name : imported.name === '*' ? found.suffix : `${imported.name}.${found.suffix}`;
      follow({ ...imported, name, meaning });
    };
    for (const use of input.uses) {
      if (input.head === null && !input.lands) {
        note(use.name, 0);
        continue;
      }
      if (use.name === '*') continue;
      const kept = lookup(landedExports, use.name);
      const present =
        kept?.suffix === '' && kept.exported.definitions.some((one) => use.meaning === 'all' || one.spaces.includes(use.meaning));
      if (present) continue;
      if (kept?.exported.imported !== undefined) {
        forward(kept, use.meaning);
        continue;
      }
      const found = lookup(workingExports, use.name);
      const exported = found?.exported;
      if (kept === undefined && exported !== undefined) note(use.name, exported.line);
      if (found?.exported.imported !== undefined) forward(found, use.meaning);
      for (const definition of found?.suffix === '' ? (exported?.definitions ?? []) : [])
        if (use.meaning === 'all' || definition.spaces.includes(use.meaning)) note(use.name, definition.line);
      if (exported === undefined) {
        const landedForwards = new Set(landed.forwards.map((one) => one.from));
        for (const forward of working.forwards) {
          if (!landedForwards.has(forward.from)) note(use.name, forward.line);
          follow({ from: forward.from, name: use.name, meaning: use.meaning });
        }
        for (const forward of landed.forwards) follow({ from: forward.from, name: use.name, meaning: use.meaning });
      }
    }
  } else {
    for (const from of landed.imports) follow({ from, name: '*', meaning: 'all' });
    for (const reference of landed.references) if (reference.imported !== undefined) follow(reference.imported);
  }
  return { dependencies, imports: [...imports.values()], facts: { working, landed, candidates }, lines, parses };
};
