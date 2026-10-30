import { readFileSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Effect, FileSystem, type PlatformError, Schema } from 'effect';
import { NATIVE_MODULES } from '../contract/wire/manifest.js';
import type { PlatformPackages } from './locked.js';

export type CarriedPackage = { readonly name: string; readonly from: string };

export type CarriedBinary = { readonly from: string; readonly to: string };

export type Native = {
  readonly packages: readonly CarriedPackage[];
  readonly binaries: readonly CarriedBinary[];
  readonly external: readonly string[];
  readonly loaded: readonly string[];
};

const Carried = Schema.Struct({
  package: Schema.String,
  bundled: Schema.optional(Schema.Literal(true)),
  platform: Schema.optional(Schema.Array(Schema.String)),
  binary: Schema.optional(Schema.Struct({ platform: Schema.String, from: Schema.String, to: Schema.String })),
  load: Schema.optional(Schema.Array(Schema.String)),
});
type Carried = typeof Carried.Type;

const Declaring = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  tagma: Schema.optional(Schema.Struct({ carried: Schema.optional(Schema.Array(Carried)) })),
});
const decodeDeclaring = Schema.decodeUnknownSync(Schema.fromJsonString(Declaring));

const WORKSPACE = 'workspace:';
const PLATFORM = '{platform}';

type Declared = { readonly from: string; readonly declarer: string; readonly carried: Carried };

const declaredFrom = (server: string): readonly Declared[] => {
  const seen = new Set<string>();
  const declared: Declared[] = [];
  const walk = (directory: string): void => {
    if (seen.has(directory)) return;
    seen.add(directory);
    const manifest = decodeDeclaring(readFileSync(`${directory}/package.json`, 'utf8'));
    for (const carried of manifest.tagma?.carried ?? []) declared.push({ from: directory, declarer: manifest.name, carried });
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (version.startsWith(WORKSPACE)) walk(dirname(Bun.resolveSync(`${name}/package.json`, directory)));
    }
  };
  walk(server);
  return declared;
};

const carrying = (name: string, base: string, held: Map<string, string>): void => {
  if (held.has(name)) return;
  const from = dirname(Bun.resolveSync(`${name}/package.json`, base));
  held.set(name, from);
  const declared = JSON.parse(readFileSync(`${from}/package.json`, 'utf8')) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  for (const dependency of Object.keys(declared.dependencies ?? {})) carrying(dependency, from, held);
};

export const nativeCarried = Effect.fnUntraced(function* (server: string, platform: string, carried: PlatformPackages) {
  const named = (template: string): string => template.replaceAll(PLATFORM, platform);
  const held = new Map<string, string>();
  const parts = yield* Effect.try({
    try: () =>
      declaredFrom(server).map(({ from, declarer, carried: one }) => {
        if (one.bundled === true && one.binary !== undefined) {
          throw new Error(`${declarer} lays a binary into ${one.package}, which it bundles`);
        }
        if (one.bundled !== true) carrying(one.package, from, held);
        return { one, at: held.get(one.package) ?? dirname(Bun.resolveSync(`${one.package}/package.json`, from)) };
      }),
    catch: (error) => `a carried package could not be resolved: ${String(error)}`,
  });
  const binaries: CarriedBinary[] = [];
  for (const { one, at } of parts) {
    for (const name of (one.platform ?? []).map(named)) {
      if (!held.has(name)) held.set(name, yield* carried(at, name));
    }
    if (one.binary !== undefined) {
      const part = yield* carried(at, named(one.binary.platform));
      binaries.push({ from: `${part}/${one.binary.from}`, to: `${one.package}/${one.binary.to}` });
    }
  }
  return {
    packages: [...held].map(([name, from]) => ({ name, from })),
    binaries,
    external: [...new Set(parts.filter(({ one }) => one.bundled !== true).map(({ one }) => one.package))],
    loaded: [...new Set(parts.flatMap(({ one }) => (one.load ?? []).map(named)))],
  } satisfies Native;
});

const SOURCE_MAP = /\.map$/;

const InstallationPackage = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  type: Schema.optional(Schema.Literal('module')),
});
const decodePackage = Schema.decodeUnknownEffect(Schema.fromJsonString(InstallationPackage));

export const writeInstallationPackage = Effect.fn('Packages.writeManifest')(
  function* (server: string, into: string) {
    const files = yield* FileSystem.FileSystem;
    const declared = yield* decodePackage(yield* files.readFileString(server));
    yield* files.writeFileString(into, `${JSON.stringify(declared, null, 2)}\n`);
  },
  (effect, server) =>
    Effect.mapError(effect, (error): string => `${server} could not give the installation its manifest: ${String(error)}`),
);

export const carryPackages = Effect.fn('Packages.carry')(
  function* (packages: readonly CarriedPackage[], root: string) {
    const files = yield* FileSystem.FileSystem;
    const held = yield* Effect.forEach(packages, (one) =>
      Effect.map(files.realPath(one.from), (from) => ({ from, to: resolve(root, NATIVE_MODULES, one.name) })),
    );
    const roots = new Map(held.map(({ from, to }) => [from, to]));
    const carriedTarget = (target: string): string | undefined => {
      let ancestor = target;
      while (true) {
        const to = roots.get(ancestor);
        if (to !== undefined) return resolve(to, relative(ancestor, target));
        const parent = dirname(ancestor);
        if (parent === ancestor) return undefined;
        ancestor = parent;
      }
    };
    const relink = Effect.fnUntraced(function* (from: string, to: string): Effect.fn.Return<void, string | PlatformError.PlatformError> {
      const entries = yield* Effect.tryPromise({
        try: () => readdir(to, { withFileTypes: true }),
        catch: (error) => `${to} could not be walked: ${String(error)}`,
      });
      for (const entry of entries) {
        const source = join(from, entry.name);
        const copied = join(to, entry.name);
        if (entry.isDirectory()) yield* relink(source, copied);
        else if (entry.isSymbolicLink()) {
          const target = yield* files.realPath(source);
          const carried = carriedTarget(target);
          if (carried === undefined) return yield* Effect.fail(`${source} resolves to ${target}, outside the carried packages`);
          yield* files.remove(copied);
          yield* files.symlink(relative(dirname(copied), carried) || '.', copied);
        }
      }
    });
    for (const one of held) {
      yield* Effect.tryPromise({
        try: () => cp(one.from, one.to, { recursive: true, verbatimSymlinks: true, filter: (path) => !SOURCE_MAP.test(path) }),
        catch: (error) => `${one.from} could not be carried: ${String(error)}`,
      });
      yield* relink(one.from, one.to);
    }
  },
  (effect) => Effect.mapError(effect, (error) => String(error)),
);

export const carryNative = Effect.fn('Packages.carryNative')(
  function* (native: Native, root: string) {
    const files = yield* FileSystem.FileSystem;
    yield* carryPackages(native.packages, root);
    for (const binary of native.binaries) {
      const to = resolve(root, NATIVE_MODULES, binary.to);
      yield* files.remove(to, { force: true });
      yield* files.makeDirectory(dirname(to), { recursive: true });
      yield* files.copyFile(binary.from, to);
      yield* files.chmod(to, 0o755);
    }
  },
  (effect) => Effect.mapError(effect, (error) => String(error)),
);
