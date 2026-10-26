import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Schema } from 'effect';
import type { Adapter } from './provider';
import { tagmaSection } from './hostModules';

export type HostModule = () => Promise<object>;
export type HostModules = {
  readonly shared: Readonly<Record<string, HostModule>>;
  readonly developer: Readonly<Record<string, HostModule>> | null;
};
export type AdapterEntry = { readonly adapter: Adapter };

const manifestSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  main: Schema.optional(Schema.String),
  exports: Schema.optional(Schema.Unknown),
  tagma: Schema.optional(tagmaSection),
});
export type PackageManifest = typeof manifestSchema.Type;
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(manifestSchema));
export const readManifest = async (directory: string): Promise<PackageManifest> =>
  decode(await readFile(join(directory, 'package.json'), 'utf8'));

const conditionOf = (target: unknown): string | null => {
  if (typeof target === 'string') return target;
  if (typeof target !== 'object' || target === null) return null;
  const conditions = target as Readonly<Record<string, unknown>>;
  for (const condition of ['bun', 'import', 'default']) {
    const found = conditionOf(conditions[condition]);
    if (found !== null) return found;
  }
  return null;
};

export const adapterEntry = (manifest: PackageManifest): string | null => {
  const exported = manifest.exports;
  if (typeof exported === 'string') return exported;
  if (typeof exported === 'object' && exported !== null) {
    const map = exported as Readonly<Record<string, unknown>>;
    const subpaths = Object.keys(map).some((key) => key.startsWith('.'));
    const found = subpaths ? (conditionOf(map['.']) ?? conditionOf(map['./adapter'])) : conditionOf(map);
    if (found !== null) return found;
  }
  return manifest.main ?? null;
};

type Hosted = { readonly exports: object } | { readonly unloadable: unknown };
let hosted: Promise<void> | undefined;
const gated = new Set<string>();
const hostOnce = (host: HostModules): Promise<void> =>
  (hosted ??= (async () => {
    const loaded: (readonly [string, Hosted])[] = [];
    for (const [specifier, module] of [...Object.entries(host.shared), ...Object.entries(host.developer ?? {})]) {
      loaded.push([
        specifier,
        await module().then(
          (exports) => ({ exports }),
          (unloadable: unknown) => ({ unloadable }),
        ),
      ]);
    }
    Bun.plugin({
      name: 'adapter-host',
      setup(build) {
        for (const [specifier, held] of loaded)
          build.module(specifier, () => {
            if ('unloadable' in held) throw held.unloadable;
            return { exports: { ...held.exports }, loader: 'object' };
          });
      },
    });
  })());

const gateInternals = (directory: string, host: HostModules): void => {
  if (gated.has(directory)) return;
  gated.add(directory);
  const internals = new Set(Object.keys(host.developer ?? {}));
  const scanner = new Bun.Transpiler({ loader: 'tsx' });
  const escaped = directory.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const loaders = { js: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx' } as const;
  Bun.plugin({
    name: `adapter-surface:${directory}`,
    setup(build) {
      build.onLoad({ filter: new RegExp(`^${escaped}/.*\\.[cm]?[jt]sx?$`) }, async ({ path }) => {
        const contents = await readFile(path, 'utf8');
        const reached = scanner.scanImports(contents).filter((one) => internals.has(one.path));
        if (reached.length > 0)
          throw new Error(
            `${path} imports ${reached.map((one) => one.path).join(', ')}, which only an adapter marked "tagma": { "build": "developer" } receives`,
          );
        const extension = path.slice(path.lastIndexOf('.') + 1).replace(/^[cm]/, '');
        return { contents, loader: loaders[extension as keyof typeof loaders] ?? 'js' };
      });
    },
  });
};

export const importAdapter = async (
  directory: string,
  host: HostModules,
  argv: readonly string[] = process.execArgv,
): Promise<AdapterEntry> => {
  if (!argv.includes('--no-install'))
    throw new Error(
      'the server runs without --no-install, so an import outside the host modules would install a second copy instead of failing; start it with bun --no-install',
    );
  const manifest = await readManifest(directory);
  const developer = manifest.tagma?.build === 'developer';
  if (developer && host.developer === null)
    throw new Error(
      `${join(directory, 'package.json')} is marked "tagma": { "build": "developer" }, and this server carries no developer modules: it loads only adapters without that mark`,
    );
  const entry = adapterEntry(manifest);
  if (entry === null) throw new Error(`${join(directory, 'package.json')} names no entry: give it "exports" or "main"`);
  const real = await realpath(directory);
  await hostOnce(host);
  if (!developer) gateInternals(real, host);
  return (await import(join(real, entry))) as AdapterEntry;
};
