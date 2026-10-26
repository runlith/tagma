import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BunPlugin } from 'bun';
import { type LoaderWindow, SurfaceLoader } from '../src/SurfaceLoader.js';
import type { LoaderState } from '../src/waitingPage.js';

type Own = { readonly bundle: string; readonly root: string; readonly digest: string };

type Frozen = {
  readonly settledPlace: (executable: string, env: NodeJS.ProcessEnv) => string | null;
  readonly ownRelease: (executable: string, env: NodeJS.ProcessEnv) => Own | null;
  readonly servedDigest: (surfaceUrl: URL, windowMs: number) => Promise<string | null>;
  readonly successorOf: (own: Own, served: string, env: NodeJS.ProcessEnv) => string | null;
};

type Met = {
  opened: boolean;
  readonly reopened: string[];
  readonly told: string[];
  readonly asked: string[];
  readonly shown: string[];
};

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FROZEN_SOURCES = [
  ':(glob)apps/tagma/desktop/src/**',
  ':(glob)apps/tagma/server/src/**',
  ':(glob)packages/*/src/**',
  ':(glob)packages/*/package.json',
];
const STANDS = new Set<LoaderState['why']>([
  'named-address',
  'not-installed',
  'not-started',
  'unrestored',
  'foreign',
  'no-installation',
  'unknown',
]);
const OPENS_WITHIN_MS = 300_000;
const SERVED_WINDOW_MS = 2_000;

const told = (code: string, reason: string): never => {
  console.log(JSON.stringify({ code, reason }));
  process.exit(2);
};

const flag = (name: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return (at < 0 ? undefined : process.argv[at + 1]) ?? told('usage', `--${name} names no value`);
};

const executable = (bundle: string): string => join(bundle, 'Contents', 'MacOS', 'Electron');

const linkPackages = (tree: string): void => {
  const scope = join(tree, 'node_modules', '@runlith');
  mkdirSync(scope, { recursive: true });
  for (const name of readdirSync(join(tree, 'packages'))) symlinkSync(join(tree, 'packages', name), join(scope, name), 'dir');
};

const exported = (tree: string, specifier: string): string => {
  try {
    return Bun.resolveSync(specifier, tree);
  } catch (error) {
    return told('frozen', `${specifier} does not resolve in the frozen tree: ${String(error)}`);
  }
};

const frozenFrom = (tree: string): BunPlugin => {
  const server = join(tree, 'apps/tagma/server/src');
  const carried = (path: string) => (existsSync(path) ? { path } : told('frozen', `${path} is not in the frozen tree`));
  return {
    name: 'frozen',
    setup(build) {
      build.onResolve({ filter: /^@tagma\/server\// }, ({ path }) =>
        carried(
          path === '@tagma/server/composition/channel'
            ? join(server, 'composition/release/channel.ts')
            : join(server, `${path.slice('@tagma/server/'.length)}.ts`),
        ),
      );
      build.onResolve({ filter: /^@runlith\// }, ({ path }) => carried(exported(tree, path)));
      build.onResolve({ filter: /^[^./]/ }, ({ path }) =>
        path.startsWith('node:') ? undefined : { path: Bun.resolveSync(path, join(checkout, 'apps/tagma/server/src')) },
      );
    },
  };
};

const frozenWindow = async (commit: string, dir: string): Promise<Frozen> => {
  const bundle = join(dir, commit, 'window.js');
  if (!existsSync(bundle)) {
    const tree = join(dir, commit, 'tree');
    mkdirSync(tree, { recursive: true });
    const archive = Bun.spawn(['/usr/bin/git', '-C', checkout, 'archive', commit, '--', ...FROZEN_SOURCES], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const unpack = Bun.spawn(['/usr/bin/tar', '-x', '-C', tree], { stdin: archive.stdout, stderr: 'pipe' });
    if ((await archive.exited) !== 0 || (await unpack.exited) !== 0) {
      told('frozen', `the window of ${commit} could not be read from git: ${await new Response(archive.stderr).text()}`);
    }
    linkPackages(tree);
    const built = await Bun.build({
      entrypoints: [join(tree, 'apps/tagma/desktop/src/release.ts')],
      target: 'bun',
      format: 'esm',
      outdir: dirname(bundle),
      naming: 'window.js',
      plugins: [frozenFrom(tree)],
    });
    if (!built.success) told('frozen', built.logs.map(String).join('\n'));
  }
  return (await import(bundle)) as Frozen;
};

const met = (bundle: string, url: string): Promise<Met> =>
  new Promise((settled) => {
    const seen: Met = { opened: false, reopened: [], told: [], asked: [], shown: [] };
    const done = () => settled(seen);
    const window: LoaderWindow = {
      open: () => {
        seen.opened = true;
        done();
      },
      show: (standing) => {
        seen.shown.push(standing.why);
        if (STANDS.has(standing.why)) done();
      },
      offer: async () => false,
      ask: async (said) => {
        seen.asked.push(said);
        return true;
      },
      told: (title, refusal) => {
        seen.told.push(`${title}: ${refusal.code}: ${refusal.reason}`);
      },
      reopen: (at) => {
        seen.reopened.push(at);
        done();
      },
      settled: () => undefined,
      fell: async () => 'left',
    };
    new SurfaceLoader(new URL(url), { executable: executable(bundle), env: process.env, named: false }, window).start();
    setTimeout(done, OPENS_WITHIN_MS).unref();
  });

const verb = process.argv[2];
if (verb === 'open') {
  console.log(JSON.stringify(await met(flag('app'), flag('url'))));
  process.exit(0);
}
if (verb === 'frozen-launch' || verb === 'frozen-follow') {
  const frozen = await frozenWindow(flag('commit'), flag('frozen'));
  const bundle = flag('app');
  if (verb === 'frozen-launch') {
    console.log(JSON.stringify({ reopen: frozen.settledPlace(executable(bundle), process.env) }));
    process.exit(0);
  }
  const own = frozen.ownRelease(executable(bundle), process.env);
  const served = await frozen.servedDigest(new URL(flag('url')), SERVED_WINDOW_MS);
  console.log(JSON.stringify({ reopen: own === null || served === null ? null : frozen.successorOf(own, served, process.env) }));
  process.exit(0);
}
told(
  'usage',
  'transition open --app <bundle> --url <url> | frozen-launch --commit <c> --frozen <dir> --app <bundle> | frozen-follow … --url <url>',
);
