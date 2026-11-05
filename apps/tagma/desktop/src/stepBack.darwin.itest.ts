import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { freePorts, op, served, servingBuild, worldEnv } from '@tagma/server/composition/testing/installation/serving';
import { EXECUTIONS_RUNTIME } from '@tagma/server/installation/contract/wire/archive';
import { DESKTOP } from '@tagma/server/installation/contract/wire/manifest';
import { RELEASE_INSIDE, hostBundle } from '@tagma/server/mac-applications/bundle';
import { swapCurrent } from '@tagma/server/platform/lock/versionedDirectories';
import { CHANNEL } from './channel.js';
import { type Leaving, stopAll } from './leaving.js';
import { carriedBy, carriedIn } from './release.js';
import { type LoaderWindow, SurfaceLoader } from './SurfaceLoader.js';

const NAME = hostBundle(CHANNEL.name);
const PAIR = new URL('../../server/src/composition/testing/installation/installedPair.ts', import.meta.url).pathname;

type Installed = { readonly version: string; readonly root: string };

const installedPair = (root: string): { readonly before: Installed; readonly leaving: Installed } => {
  const built = spawnSync(process.execPath, [PAIR, root, JSON.stringify(CHANNEL), '0.1.0', '0.2.0'], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`the installations were not built: ${built.stderr}`);
  return JSON.parse(built.stdout.trim().split('\n').at(-1)!);
};

const cloned = (from: string, to: string): void => {
  const copied = spawnSync('/bin/cp', ['-Rc', from, to]);
  if (copied.status !== 0) throw new Error(`${from} was not copied: ${copied.stderr.toString()}`);
};

const carrying = (root: string): void => {
  const bundle = join(root, DESKTOP, NAME);
  const inside = join(bundle, RELEASE_INSIDE);
  rmSync(inside, { recursive: true, force: true });
  mkdirSync(inside, { recursive: true });
  for (const name of readdirSync(root)) if (name !== DESKTOP) cloned(join(root, name), join(inside, name));
  rmSync(join(inside, EXECUTIONS_RUNTIME), { force: true });
  const signed = spawnSync('/usr/bin/codesign', ['-s', '-', '--force', '--deep', bundle]);
  if (signed.status !== 0) throw new Error(`${bundle} was not signed: ${signed.stderr.toString()}`);
};

const sleep = (ms: number): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

let base = '';
let leaving: Leaving | null = null;
let loader: SurfaceLoader | null = null;

afterEach(async () => {
  loader?.leave();
  if (leaving !== null) await stopAll(leaving);
  rmSync(base, { recursive: true, force: true });
  [loader, leaving] = [null, null];
});

test('a window open on the standing release follows a step back the server takes, becoming the application of the release before without asking', async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-back-window-')));
  const data = join(base, 'data');
  mkdirSync(data, { recursive: true });
  const { before, leaving: after } = installedPair(base);
  carrying(before.root);
  carrying(after.root);
  const installRoot = join(base, 'install');
  swapCurrent(installRoot, after.version);
  mkdirSync(join(base, 'Applications'));
  const own = join(base, 'Applications', NAME);
  cloned(join(after.root, DESKTOP, NAME), own);

  const ports = freePorts();
  const origin = `http://127.0.0.1:${ports[0]}`;
  const env = worldEnv(base, data, ports);
  const log = join(data, 'serve.log');
  leaving = { installRoot, data, log, env, carried: carriedIn(own) };
  served(after.root, env, log);
  await Effect.runPromise(servingBuild(origin, '0.2.0'));

  const seen = { opened: 0, asked: [] as string[], told: [] as string[], reopened: [] as string[], broken: null as string | null };
  const window: LoaderWindow = {
    open: () => {
      seen.opened += 1;
    },
    show: (state) => {
      if (state.why === 'unknown') seen.broken = state.detail;
    },
    offer: async () => false,
    ask: async (said) => {
      seen.asked.push(said);
      return false;
    },
    told: (_title, refusal) => {
      seen.told.push(`${refusal.code}: ${refusal.reason}`);
    },
    reopen: (at) => {
      seen.reopened.push(at);
    },
    settled: () => undefined,
    fell: async () => 'left',
  };
  const opened = new SurfaceLoader(new URL(origin), { executable: join(own, 'Contents/MacOS/Electron'), env, named: false }, window);
  loader = opened;
  const until = async (reached: () => boolean): Promise<void> => {
    while (!reached()) {
      if (seen.broken !== null) throw new Error(`the window stood on an opening that failed: ${seen.broken}`);
      if (seen.told.length > 0) throw new Error(`the window told ${seen.told.join('; ')}`);
      await sleep(100);
    }
  };
  opened.start();
  await until(() => seen.opened === 1);

  expect((await Effect.runPromise(op(origin, 'install_next', { offer: 'back', then: 'restart' }))).status).toBe(200);
  await Effect.runPromise(servingBuild(origin, '0.1.0'));
  await until(() => {
    opened.navigated();
    return seen.reopened.length === 1;
  });

  expect(seen.reopened).toEqual([own]);
  expect(carriedBy(own)?.build).toBe('0.1.0');
  expect(seen.asked).toEqual([]);
});
