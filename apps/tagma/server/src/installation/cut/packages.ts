import { readFileSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Effect, FileSystem, type PlatformError, Schema } from 'effect';
import { NATIVE_MODULES } from '../contract/wire/manifest.js';
import type { PlatformPackages } from './locked.js';

export type CarriedPackage = { readonly name: string; readonly from: string };

export type Native = { readonly packages: readonly CarriedPackage[]; readonly opencode: string };

const OPENCODE = '@opencode/cli';
const OPENCODE_BINARY = 'bin/opencode.exe';

export const nativeLoaded = (platform: string): ReadonlyArray<string> => [
  'oxc-parser',
  'typescript',
  '@embedpdf/pdfium',
  `@img/sharp-${platform}/sharp.node`,
  `@img/sharp-libvips-${platform}/package`,
];

const carrying = (name: string, base: string, held: Map<string, string>): void => {
  if (held.has(name)) return;
  const from = dirname(Bun.resolveSync(`${name}/package.json`, base));
  held.set(name, from);
  const declared = JSON.parse(readFileSync(`${from}/package.json`, 'utf8')) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  for (const dependency of Object.keys(declared.dependencies ?? {})) carrying(dependency, from, held);
};

export const nativeCarried = Effect.fnUntraced(function* (server: string, llm: string, platform: string, carried: PlatformPackages) {
  const neutral = yield* Effect.try({
    try: () => {
      const at = (name: string, base: string) => dirname(Bun.resolveSync(`${name}/package.json`, base));
      const facts = at('@runlith/code-facts', server);
      const held = new Map<string, string>();
      carrying('oxc-parser', at('oxc-parser', facts), held);
      carrying('typescript', facts, held);
      carrying('@embedpdf/pdfium', at('@runlith/agent-tools', server), held);
      carrying(OPENCODE, at('@runlith/adapter-opencode', server), held);
      return { held, sharp: at('sharp', llm), cursor: at('@cursor/sdk', at('@runlith/adapter-cursor', server)) };
    },
    catch: (error) => `a compiled module could not be resolved: ${String(error)}`,
  });
  const { held } = neutral;
  for (const [name, parent] of [
    [`@img/sharp-${platform}`, neutral.sharp],
    [`@img/sharp-libvips-${platform}`, neutral.sharp],
    [`@oxc-parser/binding-${platform}`, held.get('oxc-parser')!],
    [`@cursor/sdk-${platform}`, neutral.cursor],
  ] as const) {
    held.set(name, yield* carried(parent, name));
  }
  const opencode = `${yield* carried(held.get(OPENCODE)!, `${OPENCODE}-${platform}`)}/bin/opencode`;
  return { packages: [...held].map(([name, from]) => ({ name, from })), opencode } satisfies Native;
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
    const opencode = resolve(root, NATIVE_MODULES, OPENCODE, OPENCODE_BINARY);
    yield* files.remove(opencode, { force: true });
    yield* files.copyFile(native.opencode, opencode);
    yield* files.chmod(opencode, 0o755);
  },
  (effect) => Effect.mapError(effect, (error) => String(error)),
);
