import { Data, Effect, FileSystem, Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

export type CheckKind = 'tsc' | 'svelte';

export type WorkspaceDependency = {
  readonly name: string;
  readonly spec: string;
  readonly onWorkspace: boolean;
};

export type ProjectConfig = {
  readonly path: string;
  readonly extendsKit: boolean;
};

export type ConfigState =
  | { readonly kind: 'ok'; readonly config: ProjectConfig }
  | { readonly kind: 'invalid'; readonly path: string; readonly reason: string }
  | { readonly kind: 'absent'; readonly path: string };

export type WorkspacePackage = {
  readonly name: string;
  readonly dir: string;
  readonly kind: CheckKind | null;
  readonly deps: readonly WorkspaceDependency[];
  readonly config: ConfigState;
  readonly pendingExtends: string | null;
};

export class WorkspaceUnreadable extends Data.TaggedError('WorkspaceUnreadable')<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.path} could not be read: ${this.reason}`;
  }
}

export class RootMissing extends Data.TaggedError('RootMissing')<{
  readonly from: string;
}> {
  override get message(): string {
    return `No workspace root above ${this.from}: no package.json declaring "workspaces".`;
  }
}

const Manifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  workspaces: Schema.optional(
    Schema.Union([Schema.Array(Schema.String), Schema.Struct({ packages: Schema.optional(Schema.Array(Schema.String)) })]),
  ),
  scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

type Manifest = typeof Manifest.Type;
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

export const findRoot = Effect.fn('workspace.findRoot')(function* (
  from: string,
): Effect.fn.Return<string, RootMissing | WorkspaceUnreadable | PlatformError, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  let dir = resolve(from);
  for (;;) {
    const path = join(dir, 'package.json');
    if (yield* fileSystem.exists(path)) {
      const manifest = yield* manifestAt(fileSystem, path);
      if (manifest.workspaces !== undefined) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return yield* new RootMissing({ from });
    dir = parent;
  }
});

export const read = Effect.fn('workspace.read')(function* (
  root: string,
): Effect.fn.Return<readonly WorkspacePackage[], WorkspaceUnreadable | PlatformError, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  const rootManifest = yield* manifestAt(fileSystem, join(root, 'package.json'));

  const dirs: string[] = [];
  for (const pattern of patternsOf(rootManifest.workspaces)) {
    if (!pattern.endsWith('/*')) {
      const dir = join(root, pattern);
      if (yield* fileSystem.exists(join(dir, 'package.json'))) dirs.push(dir);
      continue;
    }
    const group = join(root, pattern.slice(0, -2));
    if (!(yield* fileSystem.exists(group))) continue;
    for (const entry of yield* fileSystem.readDirectory(group)) {
      const dir = join(group, entry);
      const info = yield* fileSystem.stat(dir);
      if (info.type !== 'Directory') continue;
      if (yield* fileSystem.exists(join(dir, 'package.json'))) dirs.push(dir);
    }
  }

  const packages: WorkspacePackage[] = [];
  for (const dir of dirs) {
    const manifest = yield* manifestAt(fileSystem, join(dir, 'package.json'));
    const name = manifest.name;
    if (name === undefined) continue;
    const declared = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
    const configPath = join(dir, 'tsconfig.json');
    packages.push({
      name,
      dir,
      kind: manifest.scripts?.typecheck === undefined ? null : 'svelte-check' in declared ? 'svelte' : 'tsc',
      deps: Object.entries(declared).map(([depName, spec]) => ({
        name: depName,
        spec,
        onWorkspace: spec.startsWith('workspace:'),
      })),
      config: (yield* fileSystem.exists(configPath)) ? yield* readProjectConfig(configPath) : { kind: 'absent', path: configPath },
      pendingExtends: (yield* fileSystem.exists(configPath)) ? yield* pendingExtendsOf(configPath) : null,
    });
  }
  return packages;
});

function patternsOf(declared: Manifest['workspaces']): readonly string[] {
  if (declared === undefined) return [];
  return isPatternList(declared) ? declared : (declared.packages ?? []);
}

function isPatternList(declared: NonNullable<Manifest['workspaces']>): declared is readonly string[] {
  return Array.isArray(declared);
}

const readProjectConfig = Effect.fn('workspace.readProjectConfig')(function* (path: string): Effect.fn.Return<ConfigState> {
  return yield* Effect.sync(() => {
    const refusals: string[] = [];
    const host: ts.ParseConfigFileHost = {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        refusals.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
      },
    };
    let parsed: ts.ParsedCommandLine | undefined;
    try {
      parsed = ts.getParsedCommandLineOfConfigFile(path, undefined, host);
    } catch (cause) {
      refusals.push(cause instanceof Error ? cause.message : String(cause));
    }
    for (const diagnostic of parsed?.errors ?? [])
      if (diagnostic.category === ts.DiagnosticCategory.Error) refusals.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    if (parsed === undefined || refusals.length > 0)
      return {
        kind: 'invalid',
        path,
        reason: refusals.join('; ') || 'TypeScript could not parse it.',
      } as const;
    const inherited = parsed.raw as { readonly extends?: string | readonly string[] } | undefined;
    const chain = inherited?.extends;
    const names = chain === undefined ? [] : typeof chain === 'string' ? [chain] : chain;
    return {
      kind: 'ok',
      config: {
        path,
        extendsKit: names.some((name) => name.includes('.svelte-kit/')),
      },
    } as const;
  });
});

const pendingExtendsOf = Effect.fn('workspace.pendingExtendsOf')(function* (path: string): Effect.fn.Return<string | null> {
  return yield* Effect.sync(() => {
    const read = ts.readConfigFile(path, ts.sys.readFile);
    if (read.error !== undefined) return null;
    const raw = read.config as { readonly extends?: string | readonly string[] } | undefined;
    const chain = raw?.extends;
    const names = chain === undefined ? [] : typeof chain === 'string' ? [chain] : chain;
    for (const name of names) {
      if (!name.startsWith('.')) continue;
      const target = resolve(dirname(path), name);
      const candidates = target.endsWith('.json') ? [target] : [target, `${target}.json`];
      if (!candidates.some((candidate) => ts.sys.fileExists(candidate))) return target;
    }
    return null;
  });
});

const manifestAt = Effect.fn('workspace.manifestAt')(function* (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.fn.Return<Manifest, WorkspaceUnreadable | PlatformError> {
  const text = yield* fileSystem.readFileString(path);
  return yield* decodeManifest(text).pipe(Effect.mapError((cause) => new WorkspaceUnreadable({ path, reason: cause.message })));
});
