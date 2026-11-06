import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { absoluteSources } from '@runlith/bundle/maps';
import { dirname, join, relative, resolve } from 'node:path';
import { serverPort, surfaceDevPort } from '@tagma/server/installation/contract/wire/ports';
import { CHANNEL } from '@tagma/server/composition/developer/channel';
import { hostFile, hostModules as hostSpecifiers, UI_MODULE } from '@tagma/server/views/contract/wire/host';
import { browserGuard } from '@runlith/vite-browser-guard/browserGuard';
import { surfaceOut } from '../surfaceOut.js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, defaultClientConditions, defaultServerConditions, type Plugin, type Rollup, type UserConfig } from 'vite';
import { BUILD_INPUTS_ENV, BUILD_MAPS_ENV, buildConditionsIn, sourceMapOriginIn } from '@tagma/server/installation/contract/wire/layout';

export type SurfaceOptions = {
  readonly runtime?: string;
  readonly sources?: readonly string[];
  readonly version?: string;
  readonly clientInputsOnly?: boolean;
};

const APP = resolve(import.meta.dirname, '..');

const RUNTIME = resolve(APP, 'src/lib/app/runtime.ts');
const STYLES = resolve(APP, 'src/app.css');
const UI = resolve(APP, 'src/lib/features/plugin-views/ui.ts');
const HOST_MODULES_ENV = 'PUBLIC_HOST_MODULES';

export function surfaceConfig(options: SurfaceOptions = {}): UserConfig {
  const backendPort = serverPort(CHANNEL, process.env);
  const built = buildConditionsIn(process.env);
  const maps = process.env[BUILD_MAPS_ENV]?.trim() || null;
  const inputs = process.env[BUILD_INPUTS_ENV]?.trim() || null;
  const sources = (options.sources ?? []).map((source) => resolve(source));
  const runtime = options.runtime === undefined ? null : resolve(options.runtime);
  return defineConfig({
    plugins: [
      ...(runtime === null ? [] : [rootRuntime(runtime)]),
      ...(sources.length === 0 ? [] : [rootSources(sources)]),
      browserGuard(),
      tailwindcss(),
      hostModules(),
      sveltekit(),
      surfaceVersion(options.version),
      ...(maps === null && inputs === null ? [] : [releaseRecord(maps, inputs, options.clientInputsOnly ?? false)]),
    ],
    build: { sourcemap: maps === null ? true : 'hidden' },
    worker: inputs === null ? undefined : { plugins: () => [workerRecord(inputs)] },
    server: {
      port: surfaceDevPort(backendPort),
      strictPort: true,
      proxy: serverProxy(backendPort),
      fs: { allow: [resolve(APP, '../../..'), ...(runtime === null ? [] : [dirname(runtime)]), ...sources] },
    },
    preview: {
      proxy: serverProxy(backendPort),
    },
    resolve: built.length === 0 ? undefined : { conditions: [...built, ...defaultClientConditions] },
    ssr: built.length === 0 ? undefined : { resolve: { conditions: [...built, ...defaultServerConditions] } },
  });
}

function rootRuntime(runtime: string): Plugin {
  return {
    name: 'tagma-root-runtime',
    enforce: 'pre',
    resolveId: {
      filter: { id: /(?:^|\/)runtime(?:\.[jt]s)?$/u },
      async handler(source, importer, options) {
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        return resolved?.id === RUNTIME ? runtime : null;
      },
    },
  };
}

function rootSources(sources: readonly string[]): Plugin {
  const scanned = sources.flatMap((source) => {
    const path = relative(dirname(STYLES), source);
    return [`@source "${path}/**/*.svelte";`, `@source "${path}/**/*.ts";`];
  });
  return {
    name: 'tagma-root-sources',
    enforce: 'pre',
    transform: {
      filter: { id: /\.css(?:\?|$)/u },
      handler(code, id) {
        return id.split('?')[0] === STYLES ? `${code}\n${scanned.join('\n')}\n` : null;
      },
    },
  };
}

function hostModules(): Plugin {
  const svelte = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('svelte/package.json'), 'utf8')) as {
    readonly exports: Readonly<Record<string, unknown>>;
  };
  const specifiers = hostSpecifiers(svelte.exports);
  const sourceOf = (specifier: string): string => (specifier === UI_MODULE ? UI : specifier);
  const shims = new Map(specifiers.map((specifier) => [`/${hostFile(specifier)}`, specifier]));
  process.env[HOST_MODULES_ENV] = JSON.stringify({ imports: Object.fromEntries([...shims].map(([path, specifier]) => [specifier, path])) });
  let building = false;
  return {
    name: 'tagma-host-modules',
    configResolved(config) {
      building = config.command === 'build';
    },
    buildStart() {
      if (!building || this.environment.name !== 'client') return;
      for (const specifier of specifiers) {
        this.emitFile({ type: 'chunk', id: sourceOf(specifier), fileName: hostFile(specifier), preserveSignature: 'strict' });
      }
    },
    resolveId: {
      filter: { id: /^\/_app\/host\//u },
      handler(id) {
        return !building && shims.has(id) ? id : null;
      },
    },
    load: {
      filter: { id: /^\/_app\/host\//u },
      handler(id) {
        const specifier = shims.get(id);
        return building || specifier === undefined ? null : `export * from ${JSON.stringify(sourceOf(specifier))};\n`;
      },
    },
  };
}

function surfaceVersion(version = gitVersion()): Plugin {
  return {
    name: 'tagma-surface-version',
    apply: 'build',
    closeBundle: {
      order: 'post',
      handler() {
        const shell = resolve(APP, surfaceOut(), 'index.html');
        if (!existsSync(shell)) return;
        const html = readFileSync(shell, 'utf8');
        if (html.includes('<html version=')) return;
        writeFileSync(shell, html.replace('<html', `<html version="${version}"`));
      },
    },
  };
}

function releaseRecord(mapsTo: string | null, inputsTo: string | null, clientOnly: boolean): Plugin {
  return {
    name: 'tagma-release-record',
    apply: 'build',
    writeBundle(options, bundle) {
      if (!clientOnly || this.environment.name === 'client') recorded(inputsTo, bundle);
      if (this.environment.name !== 'client' || options.dir === undefined) return;
      if (mapsTo !== null) for (const map of mapsUnder(options.dir)) moved(map, join(mapsTo, relative(options.dir, map)));
    },
  };
}

function workerRecord(inputsTo: string): Plugin {
  return {
    name: 'tagma-release-worker-record',
    generateBundle(_options, bundle) {
      recorded(inputsTo, bundle);
    },
  };
}

function recorded(inputsTo: string | null, bundle: Rollup.OutputBundle): void {
  if (inputsTo === null) return;
  const carried = new Set<string>(existsSync(inputsTo) ? (JSON.parse(readFileSync(inputsTo, 'utf8')) as string[]) : []);
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue;
    for (const [id, module] of Object.entries(output.modules)) if (module.renderedLength > 0) carried.add(id);
  }
  mkdirSync(dirname(inputsTo), { recursive: true });
  writeFileSync(inputsTo, JSON.stringify([...carried].sort()));
}

function mapsUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? mapsUnder(path) : entry.name.endsWith('.map') ? [path] : [];
  });
}

function moved(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, absoluteSources(readFileSync(from, 'utf8'), dirname(from), sourceMapOriginIn(process.env)));
  rmSync(from);
}

function gitVersion(): string {
  const head = git(['rev-parse', '--short', 'HEAD']);
  if (head === null) return 'no-commit';
  return git(['status', '--porcelain', '--untracked-files=no']) === '' ? head : `${head}-dirty`;
}

function git(args: readonly string[]): string | null {
  const run = spawnSync('git', [...args], { cwd: APP, encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : null;
}

function serverProxy(backendPort: number) {
  const target = `http://127.0.0.1:${backendPort}`;
  return {
    '/api': { target, changeOrigin: true, ws: true },
    '/health': { target, changeOrigin: true },
  };
}
