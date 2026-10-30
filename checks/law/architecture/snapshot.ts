import { matchesGlob, posix } from 'node:path';
import { Schema } from 'effect';
import ts from 'typescript';
import type { Side } from '@runlith/tagma/rules';
import type { Tree } from '@runlith/code-facts/tree';
import { sideTree, type HeldBlobs } from '../trees';
import { listedAt } from '../directories';
import { blobTexts, mentioning } from '../git';

export type Module = {
  readonly id: string;
  readonly card?: string;
  readonly node?: string;
  readonly imports?: readonly string[];
  readonly testing?: readonly string[];
  readonly paths: readonly { readonly kind: string; readonly ref: string }[];
};
export type Snapshot = {
  readonly tree: Tree;
  readonly paths: readonly string[];
  readonly modules: readonly Module[];
  readonly file: (path: string) => ts.SourceFile;
};

export const selectSources = (snapshot: Snapshot, paths: readonly string[]): Snapshot => ({
  tree: snapshot.tree,
  paths,
  file: snapshot.file,
  get modules() {
    return snapshot.modules;
  },
});

export const production = (path: string): boolean =>
  /\.(?:[cm]?[jt]sx?|svelte)$/.test(path) &&
  !/\.d\.[cm]?ts$|\.(?:test|itest|e2e|stest|spec|bench|fixture)\.|\/(?:testing|conformance)\.[^/]+$|\/(?:testing|test-utils|conformance|fixtures|examples|dist|build|node_modules)\//.test(
    path,
  );

export const testingEntry = (module: Module, path: string): boolean =>
  (module.testing ?? []).some((entry) => matchesGlob(path, entry) || matchesGlob(path, `${entry}/**`));

export const within = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`);
export const moduleOwners = (modules: readonly Module[]): ((path: string) => Module | undefined) => {
  const files = new Map<string, Module>();
  const directories = new Map<string, Module>();
  for (const module of modules)
    for (const source of module.paths) (source.kind === 'file' ? files : directories).set(source.ref.replace(/\/$/, ''), module);
  return (path) => {
    const exact = files.get(path);
    if (exact !== undefined) return exact;
    for (let at = path; at !== '.'; at = posix.dirname(at)) {
      const owner = directories.get(at);
      if (owner !== undefined) return owner;
    }
    return directories.get('.');
  };
};

const header = Schema.Struct({
  id: Schema.optional(Schema.String),
  edges: Schema.optional(Schema.Array(Schema.Struct({ kind: Schema.String, to: Schema.String }))),
  tags: Schema.Array(Schema.String),
  fields: Schema.Struct({
    id: Schema.optional(Schema.String),
    entries: Schema.optional(Schema.Array(Schema.Struct({ at: Schema.String, role: Schema.optional(Schema.String) }))),
  }),
  sources: Schema.Array(Schema.Struct({ kind: Schema.String, ref: Schema.String })),
});

export const moduleAt = (path: string, text: string): Module | undefined => {
  const end = text.indexOf('\n---', 4);
  if (!text.startsWith('---\n') || end === -1 || !/^tags:.*"module"/m.test(text.slice(4, end))) return undefined;
  const card = Schema.decodeUnknownSync(header)(Bun.YAML.parse(text.slice(4, end)));
  return card.fields.id === undefined
    ? undefined
    : {
        id: card.fields.id,
        card: path,
        node: card.id,
        imports: card.edges?.filter((one) => one.kind === 'imports').map((one) => one.to) ?? [],
        paths: card.sources,
        testing: (card.fields.entries ?? [])
          .filter((entry) => entry.role === 'testing')
          .flatMap((entry) => card.sources.filter((source) => source.kind === 'dir').map((source) => posix.join(source.ref, entry.at))),
      };
};

export const modulesAt = (root: string, commit: string): readonly Module[] => {
  const paths = mentioning(root, commit, '^tags:.*"module"', ['.tagma']);
  if (paths.length === 0) return [];
  const entries = listedAt(root, commit, paths, false);
  const texts = blobTexts(
    root,
    [...entries.values()].map((entry) => entry.object),
  );
  return paths.flatMap((path): Module[] => {
    const module = moduleAt(path, texts.get(entries.get(path)!.object)!);
    return module === undefined ? [] : [module];
  });
};

export const snapshots = (root: string): ((side: Side, scope?: readonly string[]) => Snapshot) => {
  const parses = new Map();
  const blobs: HeldBlobs = { listings: new Map(), texts: new Map() };
  const held = new Map<string, Snapshot>();
  return (side, scope) => {
    const key = `${side.commit}\0${scope?.join('\0') ?? (side.whole ? 'whole' : side.paths.join('\0'))}`;
    const before = held.get(key);
    if (before !== undefined) return before;
    const selected = new Set(side.paths);
    const places = scope ?? (side.whole ? [''] : [...new Set(side.paths.map((path) => posix.dirname(path)))]);
    const tree = sideTree(
      root,
      side.commit,
      { side: 'tree', paths: null, files: null },
      places,
      (path) =>
        (scope !== undefined || side.whole || selected.has(path)) &&
        ((production(path) && (within(path, 'apps/tagma/server/src') || within(path, 'apps/tagma/app/src') || within(path, 'packages'))) ||
          posix.basename(path) === 'package.json'),
      parses,
      blobs,
    );
    let parsed: ts.SourceFile | undefined;
    let parsedPath: string | undefined;
    const snapshot: Snapshot = {
      tree,
      paths: [...tree.paths!()].filter((path) => production(path)),
      get modules() {
        return modulesAt(root, side.commit);
      },
      file: (path) => {
        if (parsed === undefined || parsedPath !== path) {
          parsed = ts.createSourceFile(
            path,
            tree.read(path),
            ts.ScriptTarget.Latest,
            true,
            path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          );
          const diagnostics = (parsed as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
          if (diagnostics.length > 0) throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, '\n')}`);
          parsedPath = path;
        }
        return parsed;
      },
    };
    held.set(key, snapshot);
    return snapshot;
  };
};
