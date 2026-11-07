import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BunPlugin } from 'bun';
import { sdkHost } from '../adapter/sdkHost';
import { manifestRefusal } from './checks.generated.js';
import { computedImports } from './computed.js';
import { MANIFEST } from '../manifest.js';
import { describePlugin, manifestOf, PluginInvalid, PROCESS_ENTRY } from './describe.js';
import { BuildFailed } from './failure.js';
import type { PluginDefinition } from './plugin.js';
import type { PluginEnvelope } from './points.generated.js';
import { buildProviders, PROVIDERS_ENTRY } from './providers.js';
import { typeCheck } from './types.js';
import { buildViews, publishViews } from './views.js';

const DEFINITION = 'plugin.ts';

const NAMESPACE = 'tagma-plugin';

const ENTRY = `${NAMESPACE}:process`;

const DRAFT_BUILD = { hash: '0'.repeat(64), sources: [] };

type Built = { readonly manifest: PluginEnvelope; readonly process: boolean };

const versionOf = async (directory: string): Promise<string> => {
  const path = join(directory, 'package.json');
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new BuildFailed('package', `${path} is missing: the plugin's version comes from it`);
    throw error;
  });
  const { version } = JSON.parse(text) as { readonly version?: unknown };
  if (typeof version !== 'string' || version === '') throw new BuildFailed('package', `${path} names no version`);
  return version;
};

const definitionOf = async (directory: string): Promise<PluginDefinition> => {
  const module = (await import(join(directory, DEFINITION))) as { readonly default?: unknown };
  const definition = module.default;
  if (typeof definition !== 'object' || definition === null || !('id' in definition) || !('title' in definition))
    throw new BuildFailed(
      'definition',
      `${DEFINITION} exports no plugin as its default: write export default definePlugin({ id, title, … })`,
    );
  return definition as PluginDefinition;
};

const entryPlugin = (directory: string): BunPlugin => ({
  name: 'tagma-plugin',
  setup: (build) => {
    build.onResolve({ filter: /^tagma-plugin:process$/u }, () => ({ path: ENTRY, namespace: NAMESPACE }));
    build.onLoad({ filter: /.*/u, namespace: NAMESPACE }, () => ({
      loader: 'ts',
      resolveDir: directory,
      contents: [
        `import { servePlugin } from ${JSON.stringify(fileURLToPath(import.meta.resolve('@runlith/tagma/plugin/process')))};`,
        `import plugin from ${JSON.stringify(join(directory, DEFINITION))};`,
        'await servePlugin(plugin);',
        '',
      ].join('\n'),
    }));
    build.onLoad({ filter: /\.node$/u }, ({ path }) => {
      throw new BuildFailed('bundle', `${path} is a native addon, which a plugin's process cannot carry`);
    });
  },
});

const bundled = async (directory: string): Promise<{ readonly code: string; readonly read: readonly string[] }> => {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    plugins: [entryPlugin(directory)],
    target: 'bun',
    format: 'esm',
    minify: true,
    sourcemap: 'external',
    throw: false,
  });
  if (!result.success) throw new BuildFailed('bundle', result.logs.map((log) => String(log)).join('\n'));
  const code = result.outputs.find((output) => output.kind === 'entry-point');
  const map = result.outputs.find((output) => output.kind === 'sourcemap');
  if (code === undefined || map === undefined) throw new BuildFailed('bundle', 'the bundler answered no process module');
  const text = await code.text();
  const computed = computedImports(text);
  if (computed > 0)
    throw new BuildFailed(
      'bundle',
      `the process names a module by a computed value in ${computed} import or require ${computed === 1 ? 'call' : 'calls'}, which its runtime cannot install: import each module by its literal name`,
    );
  const { sources } = JSON.parse(await map.text()) as { readonly sources: readonly string[] };
  const real = sources.filter((source) => !source.startsWith(`${NAMESPACE}:`));
  const base = await realpath(process.cwd());
  return { code: text, read: real.map((source) => resolve(base, source)) };
};

const sourcesOf = (directory: string, read: readonly string[]): readonly string[] => {
  const inside = read.flatMap((file) => {
    const path = relative(directory, file).replaceAll('\\', '/');
    return path === '' || path.startsWith('../') || path.split('/').includes('node_modules') ? [] : [path];
  });
  return [...new Set([...inside, 'package.json'])].sort();
};

const sourceHash = async (directory: string, sources: readonly string[]): Promise<string> => {
  const hash = createHash('sha256');
  for (const path of sources) {
    const bytes = await readFile(join(directory, path));
    hash.update(`${path}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
};

export const buildPlugin = async (folder: string): Promise<Built> => {
  const directory = await realpath(resolve(folder));
  const version = await versionOf(directory);
  await typeCheck(directory);
  const definition = await definitionOf(directory);
  const described = (() => {
    try {
      return describePlugin(definition);
    } catch (error) {
      if (error instanceof PluginInvalid) throw new BuildFailed('definition', error.message);
      throw error;
    }
  })();
  const { id, title, description, process, options, contributes } = manifestOf(described);
  const drafted = manifestRefusal(
    JSON.parse(JSON.stringify({ id, title, version, description, process, options, build: DRAFT_BUILD, contributes })),
  );
  if (drafted !== null) throw new BuildFailed('check', `${MANIFEST}: ${drafted}`);
  const { code, read } = await bundled(directory);
  const providers =
    definition.providers === undefined ? null : await buildProviders(directory, definition.providers, { id, version }, await sdkHost());
  const points = described.contributes;
  const entries = (points.views ?? []).map((shown) => shown.entry);
  const icons = [...(points.surfaces ?? []), ...(points.panes ?? [])].flatMap((section) =>
    section.icon === undefined ? [] : [section.icon],
  );
  const views = entries.length === 0 ? null : await buildViews({ directory, entries, icons });
  try {
    const sources = sourcesOf(directory, [...read, ...(providers?.read ?? []), ...(views?.read ?? [])]);
    const build = { hash: await sourceHash(directory, sources), sources };
    const contributed = {
      ...contributes,
      ...(points.views === undefined
        ? {}
        : { views: points.views.map((shown) => (views?.media.has(shown.entry) ? { ...shown, media: true } : shown)) }),
    };
    const text = `${JSON.stringify({ id, title, version, description, process, providers: providers?.envelope, options, build, contributes: contributed }, null, 2)}\n`;
    const manifest = JSON.parse(text) as PluginEnvelope;
    const refused = manifestRefusal(manifest);
    if (refused !== null) throw new BuildFailed('check', `${MANIFEST}: ${refused}`);
    const entry = join(directory, PROCESS_ENTRY);
    if (described.process === null) await rm(entry, { force: true });
    else {
      await mkdir(dirname(entry), { recursive: true });
      await writeFile(entry, code);
    }
    const providersFile = join(directory, PROVIDERS_ENTRY);
    if (providers === null) await rm(providersFile, { force: true });
    else {
      await mkdir(dirname(providersFile), { recursive: true });
      await writeFile(providersFile, providers.code);
    }
    await publishViews(views, directory);
    await writeFile(join(directory, MANIFEST), text);
    return { manifest, process: described.process !== null };
  } finally {
    if (views !== null) await rm(views.stage, { recursive: true, force: true });
  }
};
