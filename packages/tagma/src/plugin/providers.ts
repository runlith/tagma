import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { BunPlugin } from 'bun';
import { speechCatalog } from '@runlith/speech/engine/catalog';
import { declare } from '../adapter/declaration';
import { importProviders } from '../adapter/loader';
import type { HostModules } from '../adapter/loader';
import { computedImports } from './computed.js';
import { MANIFEST } from '../manifest.js';
import { BuildFailed } from './failure.js';
import type { PluginEnvelope } from './points.generated.js';

export const PROVIDERS_ENTRY = 'dist/providers.js';

type ProvidersEnvelope = NonNullable<PluginEnvelope['providers']>;

type BuiltProviders = {
  readonly code: string;
  readonly read: readonly string[];
  readonly envelope: ProvidersEnvelope;
};

const NO_INSTALL: readonly string[] = ['--no-install'];

const DESCRIBING = { mcpServer: 'describe', client: { name: 'tagma-plugin', version: 'build' } } as const;

const BUILTIN = new Set(builtinModules);

const served = (path: string, host: HostModules): boolean =>
  Object.hasOwn(host, path) || path.startsWith('node:') || path.startsWith('bun:') || path === 'bun' || BUILTIN.has(path);

const importsOutside = (code: string, host: HostModules): readonly string[] => {
  const { imports } = new Bun.Transpiler({ loader: 'js' }).scan(code);
  return [...new Set(imports.map(({ path }) => path).filter((path) => !served(path, host)))];
};

const noNativeAddons = (): BunPlugin => ({
  name: 'tagma-providers',
  setup: (build) => {
    build.onLoad({ filter: /\.node$/u }, ({ path }) => {
      throw new BuildFailed('bundle', `${path} is a native addon, which a plugin's provider part cannot carry`);
    });
  },
});

const bundled = async (
  directory: string,
  module: string,
  host: HostModules,
): Promise<{ readonly code: string; readonly read: readonly string[] }> => {
  const entry = resolve(directory, module);
  const inside = relative(directory, entry);
  if (isAbsolute(module) || inside.startsWith('..') || isAbsolute(inside))
    throw new BuildFailed('bundle', `providers ${JSON.stringify(module)} is not a file inside the plugin folder`);
  if (!(await Bun.file(entry).exists()))
    throw new BuildFailed(
      'bundle',
      `providers names ${module}, which does not exist: write it with export default defineProviders({ models, speech })`,
    );
  const result = await Bun.build({
    entrypoints: [entry],
    plugins: [noNativeAddons()],
    external: Object.keys(host),
    target: 'bun',
    format: 'esm',
    minify: true,
    sourcemap: 'external',
    throw: false,
  });
  if (!result.success) throw new BuildFailed('bundle', result.logs.map((log) => String(log)).join('\n'));
  const code = result.outputs.find((output) => output.kind === 'entry-point');
  const map = result.outputs.find((output) => output.kind === 'sourcemap');
  if (code === undefined || map === undefined) throw new BuildFailed('bundle', 'the bundler answered no providers module');
  const text = await code.text();
  const computed = computedImports(text);
  if (computed > 0)
    throw new BuildFailed(
      'bundle',
      `the provider part names a module by a computed value in ${computed} import or require ${computed === 1 ? 'call' : 'calls'}, which the server cannot serve: import each module by its literal name`,
    );
  const outside = importsOutside(text, host);
  if (outside.length > 0)
    throw new BuildFailed(
      'bundle',
      `the provider part imports ${outside.join(', ')}, which the server serves no copy of: the server runs it with --no-install, so only host modules, Node and Bun modules may stay imports`,
    );
  const { sources } = JSON.parse(await map.text()) as { readonly sources: readonly string[] };
  const base = await realpath(process.cwd());
  return { code: text, read: sources.map((source) => resolve(base, source)) };
};

const described = async (
  code: string,
  identity: { readonly id: string; readonly version: string },
  host: HostModules,
): Promise<Omit<ProvidersEnvelope, 'entry'>> => {
  const stage = await mkdtemp(join(tmpdir(), 'tagma-providers-'));
  try {
    await writeFile(join(stage, 'providers.js'), code);
    await writeFile(join(stage, MANIFEST), JSON.stringify({ ...identity, providers: { entry: 'providers.js' } }));
    const { models, speech } = await importProviders(stage, host, NO_INSTALL);
    const declared = models === undefined ? undefined : declare(models, { product: DESCRIBING, instances: [] });
    if (speech !== undefined) {
      const refused = speechCatalog([{ owner: identity.id, providers: speech }]).faults;
      if (refused.length > 0) throw new Error(refused.map((fault) => fault.reason).join('\n'));
    }
    const brings = {
      models: models !== undefined,
      harnesses: declared?.providers.some((provider) => provider.kind === 'harness') ?? false,
      speech: speech !== undefined && speech.length > 0,
    };
    if (!brings.models && !brings.speech) throw new Error('the provider part declares no models and no speech providers');
    return brings;
  } catch (error) {
    if (error instanceof BuildFailed) throw error;
    throw new BuildFailed('providers', error instanceof Error ? error.message : String(error));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
};

export const buildProviders = async (
  directory: string,
  module: string,
  identity: { readonly id: string; readonly version: string },
  host: HostModules,
): Promise<BuiltProviders> => {
  const { code, read } = await bundled(directory, module, host);
  return { code, read, envelope: { entry: PROVIDERS_ENTRY, ...(await described(code, identity, host)) } };
};
