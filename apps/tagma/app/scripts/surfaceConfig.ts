import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { absoluteSources } from '@runlith/bundle/maps';
import { dirname, join, relative, resolve } from 'node:path';
import { serverPort, surfaceDevPort } from '@tagma/server/installation/contract/wire/ports';
import { CHANNEL } from '@tagma/server/composition/channel';
import { browserGuard } from '@runlith/vite-browser-guard/browserGuard';
import { surfaceOut } from '../surfaceOut.js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, defaultClientConditions, defaultServerConditions, type Plugin, type Rollup, type UserConfig } from 'vite';
import { BUILD_INPUTS_ENV, BUILD_MAPS_ENV, buildConditionsIn } from '@tagma/server/installation/contract/wire/layout';

export type SurfaceOptions = {
  readonly plugins?: readonly Plugin[];
  readonly version?: string;
  readonly clientInputsOnly?: boolean;
};

const APP = resolve(import.meta.dirname, '..');

export const SURFACE_RUNTIME = resolve(APP, 'src/lib/app/runtime.ts');
export const SURFACE_STYLES = resolve(APP, 'src/app.css');

export function surfaceConfig(options: SurfaceOptions = {}): UserConfig {
  const backendPort = serverPort(CHANNEL, process.env);
  const built = buildConditionsIn(process.env);
  const maps = process.env[BUILD_MAPS_ENV]?.trim() || null;
  const inputs = process.env[BUILD_INPUTS_ENV]?.trim() || null;
  return defineConfig({
    plugins: [
      ...(options.plugins ?? []),
      browserGuard(),
      tailwindcss(),
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
      fs: { allow: [resolve(APP, '../../..')] },
    },
    preview: {
      proxy: serverProxy(backendPort),
    },
    resolve: built.length === 0 ? undefined : { conditions: [...built, ...defaultClientConditions] },
    ssr: built.length === 0 ? undefined : { resolve: { conditions: [...built, ...defaultServerConditions] } },
  });
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
  writeFileSync(to, absoluteSources(readFileSync(from, 'utf8'), dirname(from)));
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
