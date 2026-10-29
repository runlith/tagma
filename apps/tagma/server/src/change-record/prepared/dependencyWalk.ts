import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { totalmem } from 'node:os';
import { contentDigest } from '@runlith/files/content';
import { blobTree, type ParseMemo } from '@runlith/code-facts/blobs';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { SymbolImport, SymbolMeaning, SymbolReader, Symbols } from '@runlith/code-facts/adapter';
import type { Tree } from '@runlith/code-facts/tree';
import type { SelectedSpan } from '../lines/selection.js';

export type PeerLine = { readonly line: number; readonly holder: string | null };
export type Dependency = PeerLine & { readonly path: string; readonly name: string };
export type ImportedUse = { readonly path: string; readonly name: string; readonly meaning: SymbolMeaning };
export type BoundTexts = { readonly working: Symbols; readonly selected: Symbols; readonly candidates: readonly Dependency[] };
export type DependencyInput = {
  readonly root: string;
  readonly path: string;
  readonly working: string;
  readonly selected: string | null;
  readonly peers: readonly PeerLine[];
  readonly positions?: readonly SelectedSpan[];
  readonly lines?: readonly number[];
  readonly uses?: readonly ImportedUse[];
  readonly facts?: BoundTexts;
};
export type DependencyProbe = { readonly root: string; readonly path: string; readonly text?: string; readonly capture: number };
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
  readonly closed: readonly string[];
  readonly capture: number;
};
export type DependencyAnswer = {
  readonly dependencies: readonly Dependency[];
  readonly imports: readonly ImportedUse[];
  readonly facts: BoundTexts | undefined;
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

export const dependencyImportsOf = async (input: DependencyProbe): Promise<ImportProbe> => {
  const adapter = ADAPTERS.find((one) => one.parses(input.path));
  if (adapter === undefined) return { text: undefined, paths: [], reads: 0, importMs: 0 };
  const path = join(input.root, input.path);
  if (input.text === undefined && !treeAt(input.root).has(input.path)) return { text: undefined, paths: [], reads: 0, importMs: 0 };
  if (input.text === undefined && statSync(path).size > input.capture) throw new Error(`${input.path} exceeds its dependency text capture`);
  const text = input.text ?? readFileSync(path, 'utf8');
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
    const direct = adapter.resolve(site.specifier, input.path, tree);
    const resolved =
      direct !== null && 'to' in direct
        ? direct
        : adapter.symbols === undefined
          ? null
          : (reader ??= await adapter.symbols()).resolve(site.specifier, input.path, tree);
    if (resolved === null || !('to' in resolved)) continue;
    const target = tree.realpath!(resolved.to);
    if (target !== '..' && !target.startsWith('../')) paths.add(target);
  }
  return { text, paths: [...paths], reads: hit ? 0 : 1, importMs };
};

export const placementsOf = async (input: PlacementInput): Promise<readonly string[]> => {
  const adapter = ADAPTERS.find((one) => one.parses(input.path));
  if (adapter?.symbols === undefined) return [];
  const reader = await adapter.symbols();
  const disk = treeAt(input.root);
  const texts = new Map(input.texts);
  const closed = new Set(input.closed);
  const tree: Tree = {
    has: (path) => (texts.has(path) ? texts.get(path) !== null : !closed.has(path) && disk.has(path)),
    read: (path) => texts.get(path) ?? disk.read(path),
    size: (path) =>
      texts.has(path) ? texts.get(path)?.length : closed.has(path) || !disk.has(path) ? undefined : statSync(join(input.root, path)).size,
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
  if (adapter?.symbols === undefined) return { dependencies: [], imports: [], facts: undefined, parses: 0 };
  const reader = await adapter.symbols();
  let parses = 0;
  const read = (text: string, lines?: readonly number[]): Symbols => {
    parses += 1;
    return reader.read(text, input.path, lines);
  };
  const working = input.facts?.working ?? read(input.working);
  const selected =
    input.facts?.selected ??
    (input.selected === null
      ? EMPTY
      : input.selected === input.working && input.lines === undefined
        ? working
        : read(input.selected, input.lines));
  const peers = new Map(input.peers.map((one) => [one.line, one.holder]));
  const keptNames = new Set(selected.names.map((one) => `${one.owner}\0${one.name}`));
  const candidates =
    input.facts?.candidates ??
    working.names.flatMap((one): Dependency[] => {
      const holder = peers.get(one.line);
      return holder === undefined || keptNames.has(`${one.owner}\0${one.name}`)
        ? []
        : [{ path: input.path, name: one.name, line: one.line, holder }];
    });
  const dependencies: Dependency[] = [];
  const imports = new Map<string, ImportedUse>();
  const tree = treeAt(input.root);
  const resolutions = new Map<string, string | null>();
  const follow = (imported: SymbolImport): void => {
    let path = resolutions.get(imported.from);
    if (path === undefined) {
      const resolved = reader.resolve(imported.from, input.path, tree);
      path = resolved !== null && 'to' in resolved ? tree.realpath!(resolved.to) : null;
      resolutions.set(imported.from, path);
    }
    if (path === null || path.startsWith('../') || path === '..') return;
    const one = { path, name: imported.name, meaning: imported.meaning };
    imports.set(`${path}\0${one.name}\0${one.meaning}`, one);
  };
  const note = (name: string, line: number): void => {
    const holder = peers.get(line);
    if (holder !== undefined) dependencies.push({ path: input.path, name, line, holder });
  };
  if (input.uses !== undefined) {
    const selectedExports = new Map(selected.exports.map((one) => [one.name, one]));
    const workingExports = new Map(working.exports.map((one) => [one.name, one]));
    const lookup = (exports: typeof selectedExports, name: string) => {
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
      if (input.selected === null && peers.has(0)) {
        note(use.name, 0);
        continue;
      }
      if (use.name === '*') continue;
      const kept = lookup(selectedExports, use.name);
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
        const selectedForwards = new Set(selected.forwards.map((one) => one.from));
        for (const forward of working.forwards) {
          if (!selectedForwards.has(forward.from)) note(use.name, forward.line);
          follow({ from: forward.from, name: use.name, meaning: use.meaning });
        }
        for (const forward of selected.forwards) follow({ from: forward.from, name: use.name, meaning: use.meaning });
      }
    }
  } else {
    for (const from of selected.imports) follow({ from, name: '*', meaning: 'all' });
    const at = new Map(working.references.map((one) => [`${one.line}:${one.column}:${one.name}`, one]));
    for (const reference of selected.references) {
      if (reference.imported !== undefined) {
        follow(reference.imported);
        continue;
      }
      if (reference.definitions.length > 0) continue;
      const positions = input.positions ?? [];
      let low = 0;
      let high = positions.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (positions[middle]!.selected + positions[middle]!.count <= reference.line) low = middle + 1;
        else high = middle;
      }
      const span = positions[low];
      const line =
        span === undefined || span.selected > reference.line
          ? input.selected === input.working
            ? reference.line
            : undefined
          : span.working + reference.line - span.selected;
      if (line === undefined) continue;
      const original = at.get(`${line}:${reference.column}:${reference.name}`);
      if (original?.imported !== undefined) follow(original.imported);
      for (const definition of original?.definitions ?? []) note(reference.name, definition.line);
    }
  }
  return { dependencies, imports: [...imports.values()], facts: { working, selected, candidates }, parses };
};
