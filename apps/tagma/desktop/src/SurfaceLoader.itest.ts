import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CHANNEL } from '@tagma/server/composition/channel';
import { ATTEMPT_FILE, RELEASE_INSIDE, dataDirectory, hostBundle } from '@tagma/server/installation/contract/wire/layout';
import { RESTART_RECORD, type RestartRecord } from '@tagma/server/installation/contract/wire/restart';
import { LOCK_FILE } from '@tagma/server/platform/contract/wire/lock';
import { type LoaderWindow, SurfaceLoader } from './SurfaceLoader.js';
import type { Fallen } from './release.js';
import type { Stalled } from './server.js';
import { stopIdle } from './leaving.js';
import { moveToApplications } from './placing.js';
import type { LoaderState } from './waitingPage.js';

const NAME = hostBundle(CHANNEL.name);

const FAKE = `#!/bin/sh
if [ "$1" = -e ]; then echo "probe $$ $0" >> "$ACTS"; exec "$REAL_BUN" "$@"; fi
shift; shift
verb="$1"; shift
echo "$verb $$ $0 $*" >> "$ACTS"
case "$verb" in
  install-from)
    agreed=0
    for arg in "$@"; do [ "$arg" = --agreed ] && agreed=1; dir="$arg"; done
    if [ -f "$ASK" ] && [ "$agreed" = 0 ]; then printf '{"status":"ask","reason":"failed","said":"%s"}\\n' "$(cat "$ASK")"; exit 0; fi
    build=$(sed -n 's/.*"build":"\\([^"]*\\)".*/\\1/p' "$dir/install.json")
    root="$TAGMA_INSTALL_ROOT/$build"
    if [ ! -f "$root/install.json" ]; then
      mkdir -p "$root/desktop"; cp -R "$dir/." "$root/"
      cp -R "\${dir%/${RELEASE_INSIDE}}" "$root/desktop/${NAME}"
    fi
    if [ -f "$HELD" ]; then echo '{"status":"held"}'; exit 0; fi
    ln -sfn "$build" "$TAGMA_INSTALL_ROOT/current"
    echo '{"status":"landed"}' ;;
  serve)
    if [ -f "$ROLLBACK" ]; then ln -sfn "$(cat "$ROLLBACK")" "$TAGMA_INSTALL_ROOT/current"; rm "$ROLLBACK"; exit 1; fi
    if [ -f "$UNRETURNED" ]; then exit 1; fi
    if [ -f "$LOSES" ]; then while [ ! -f "$TAKEN" ]; do sleep 0.05; done; exit 1; fi
    exec sleep 30 ;;
  quit) echo '{"stopped":true}' ;;
esac
`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleIdentifier</key><string>dev.tagma.window-test</string></dict></plist>
`;

const HOLD = `const { dlopen } = require('bun:ffi');
const libc = dlopen('libc.dylib', { flock: { args: ['i32', 'i32'], returns: 'i32' } });
libc.symbols.flock(require('node:fs').openSync(process.env.HELD, 'w'), 2);
console.log('held');
setInterval(() => {}, 1000);`;

type Bearing = { readonly build: string; readonly digest: string };

const bearing = (build: string): Bearing => ({ build, digest: `sha256:${createHash('sha256').update(build).digest('hex')}` });

let base = '';
let installRoot = '';
let data = '';
let env: NodeJS.ProcessEnv = {};
let port = 0;
let stub: ReturnType<typeof Bun.serve> | null = null;
let served: Bearing | null = null;
let database = '';
let terminals = 0;
let restarts = 0;
let refusing: string | null = null;
let unhosting: 'named' | 'unnamed' | null = null;
let needsHost: string | null = null;
let stalled: Stalled | null = null;
let holder: ReturnType<typeof Bun.spawn> | null = null;
let changes: EventEmitter;
let observed: FSWatcher;
const loaders: SurfaceLoader[] = [];

const written = (path: string, text: string, mode = 0o644): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode });
};

const releaseAt = (at: string, build: string): void => {
  const { digest } = bearing(build);
  written(
    join(at, 'install.json'),
    JSON.stringify({
      version: 1,
      identity: { digest, build },
      platform: { os: 'darwin', arch: 'arm64' },
      parts: [{ role: 'runtime', path: 'bun', kind: 'file', bytes: 1, digest }],
    }),
  );
  written(join(at, 'bun'), FAKE, 0o755);
  written(join(at, 'bin/cli/main.js'), '');
};

const application = (folder: string, build: string, name = NAME): string => {
  const bundle = join(folder, name);
  written(join(bundle, 'Contents/MacOS/Electron'), '#!/bin/sh\n', 0o755);
  written(join(bundle, 'Contents/Info.plist'), PLIST);
  releaseAt(join(bundle, RELEASE_INSIDE), build);
  const signed = spawnSync('/usr/bin/codesign', ['-s', '-', '--force', '--deep', bundle]);
  if (signed.status !== 0) throw new Error(`the fake application was not signed: ${signed.stderr.toString()}`);
  return bundle;
};

const installed = (build: string): string => {
  releaseAt(join(installRoot, build), build);
  application(join(installRoot, build, 'desktop'), build);
  standOn(build);
  return join(installRoot, build, 'desktop', NAME);
};

const standOn = (build: string): void => {
  rmSync(join(installRoot, 'current'), { force: true });
  symlinkSync(build, join(installRoot, 'current'));
};

const current = (): string | null => (existsSync(join(installRoot, 'current')) ? readlinkSync(join(installRoot, 'current')) : null);
const carried = (bundle: string): string => JSON.parse(readFileSync(join(bundle, RELEASE_INSIDE, 'install.json'), 'utf8')).identity.build;
const lines = (): readonly string[] => (existsSync(env.ACTS!) ? readFileSync(env.ACTS!, 'utf8').split('\n').filter(Boolean) : []);
const acts = (): readonly string[] =>
  lines()
    .map((line) => line.split(' ')[0]!)
    .filter((verb) => verb !== 'probe');
const probes = (): number => lines().filter((line) => line.startsWith('probe ')).length;

const answering = (): void => {
  stub = Bun.serve({
    port,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/health') return Response.json({ ok: true, database, source: { installation: served }, stalled });
      if (path === '/api/op/read_machine_state')
        return Response.json({
          status: 'read',
          machine: {
            server: { agents: 0, calls: 0, next: { installing: null } },
            host: { holds: { terminals, commands: 0 } },
            restart: { stage: null },
            newHost:
              needsHost === null
                ? undefined
                : { cause: 'update', build: needsHost, host: served?.build ?? null, detail: 'the host refused', ends: [], back: null },
          },
        });
      if (path === '/api/op/restart_server') {
        restarts += 1;
        changes.emit('changed');
        if (unhosting !== null) {
          if (unhosting === 'named') needsHost = current();
          return Response.json(
            { code: 'host-unprepared', reason: 'the host refused; this server and its execution host keep running', unblock: [] },
            { status: 409 },
          );
        }
        if (refusing !== null) {
          writeFileSync(join(data, RESTART_RECORD), restartRecord(process.pid, refusing));
          return Response.json({ status: 'restarting', restart: {} });
        }
        const now = current();
        served = now === null ? null : bearing(now);
        return Response.json({ status: 'restarting', restart: {} });
      }
      return new Response('', { status: 404 });
    },
  });
  const record = join(data, RESTART_RECORD);
  if (!existsSync(record)) {
    const now = Date.now();
    written(
      record,
      JSON.stringify({
        id: 'ready',
        startup: { pid: process.pid, startedAt: now, readyAt: now, expectedMs: null, step: null },
        predecessor: null,
        successor: null,
        phases: [],
        points: [],
        frames: [],
        windows: [],
        failure: null,
      } satisfies RestartRecord),
    );
  }
};

const holding = async (): Promise<void> => {
  const held = Bun.spawn([process.execPath, '-e', HOLD], { env: { ...env, HELD: join(data, LOCK_FILE) }, stdout: 'pipe' });
  holder = held;
  const reader = held.stdout.getReader();
  await reader.read();
  reader.releaseLock();
};

type Seen = {
  readonly loader: SurfaceLoader;
  readonly shown: LoaderState[];
  readonly asked: string[];
  readonly told: string[];
  readonly reopened: string[];
  readonly fell: Fallen[];
  opened: number;
};

const windowOf = (bundle: string, agrees = false): Seen => {
  const seen = {
    shown: [] as LoaderState[],
    asked: [] as string[],
    told: [] as string[],
    reopened: [] as string[],
    fell: [] as Fallen[],
    opened: 0,
  };
  const events = changes;
  const changed = () => setImmediate(() => events.emit('changed'));
  const window: LoaderWindow = {
    open: () => {
      seen.opened += 1;
      changed();
    },
    show: (state) => {
      seen.shown.push(state);
      changed();
    },
    offer: async () => false,
    ask: async (said) => {
      seen.asked.push(said);
      changed();
      return agrees;
    },
    told: (_title, refusal) => {
      seen.told.push(refusal.code);
      changed();
    },
    reopen: (at) => {
      seen.reopened.push(at);
      changed();
    },
    settled: () => undefined,
    fell: async (fallen) => {
      seen.fell.push(fallen);
      changed();
      return agrees ? 'retry' : 'left';
    },
  };
  const loader = new SurfaceLoader(
    new URL(`http://127.0.0.1:${port}`),
    { executable: join(bundle, 'Contents/MacOS/Electron'), env, named: false },
    window,
  );
  loaders.push(loader);
  return Object.assign(seen, { loader });
};

async function until(reached: () => boolean): Promise<void> {
  while (!reached()) await once(changes, 'changed');
}

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-window-')));
  changes = new EventEmitter();
  const events = changes;
  installRoot = join(base, 'install');
  env = {
    HOME: join(base, 'home'),
    TAGMA_INSTALL_ROOT: installRoot,
    PATH: '/usr/bin:/bin',
    ACTS: join(base, 'acts'),
    ASK: join(base, 'ask'),
    ROLLBACK: join(base, 'rollback'),
    UNRETURNED: join(base, 'unreturned'),
    LOSES: join(base, 'loses'),
    TAKEN: join(base, 'taken'),
    HELD: join(base, 'held'),
    REAL_BUN: process.execPath,
  };
  written(env.ACTS!, '');
  observed = watch(env.ACTS!, { persistent: false }, () => events.emit('changed'));
  observed.on('error', (error) => events.emit('error', error));
  data = dataDirectory(CHANNEL, env)!;
  database = join(data, 'tagma.sqlite');
  mkdirSync(data, { recursive: true });
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  port = probe.port!;
  await probe.stop(true);
  [stub, served, terminals, restarts, refusing, unhosting, needsHost, stalled, holder] = [null, null, 0, 0, null, null, null, null, null];
});

afterEach(async () => {
  for (const loader of loaders.splice(0)) loader.leave();
  for (const line of lines())
    if (line.startsWith('serve '))
      try {
        process.kill(Number(line.split(' ')[1]), 'SIGKILL');
      } catch {}
  holder?.kill('SIGKILL');
  await stub?.stop(true);
  observed.close();
  changes.removeAllListeners();
  chmodSync(base, 0o755);
  for (const folder of ['Downloads', 'Volume', 'System']) if (existsSync(join(base, folder))) chmodSync(join(base, folder), 0o755);
  rmSync(base, { recursive: true, force: true });
});

test.each(['Downloads', 'Volume'])(
  'a first launch from %s installs the release the application carries, starts its server and opens it; the next launch does neither',
  async (folder) => {
    const bundle = application(join(base, folder), '0.2.0');
    if (folder === 'Volume') chmodSync(join(base, folder), 0o555);
    const first = windowOf(bundle);

    first.loader.start();
    await until(() => acts().includes('serve'));
    served = bearing('0.2.0');
    answering();
    await until(() => first.opened === 1);

    expect(acts()).toEqual(['install-from', 'serve']);
    expect(current()).toBe('0.2.0');
    expect(carried(join(installRoot, '0.2.0', 'desktop', NAME))).toBe('0.2.0');
    expect(first.shown[0]).toEqual({ why: 'installing', build: '0.2.0' });

    const again = windowOf(bundle);
    again.loader.start();
    await until(() => again.opened === 1);
    expect(acts()).toEqual(['install-from', 'serve']);
    expect(again.shown).toEqual([]);
  },
);

test('leaving while the release lease is acquired keeps the window hidden', async () => {
  const bundle = installed('0.1.0');
  served = bearing('0.1.0');
  answering();
  const entered = Promise.withResolvers<void>();
  const acquired = Promise.withResolvers<void>();
  let visible = 'hidden';
  const window: LoaderWindow = {
    open: () => {
      visible = 'surface';
    },
    show: () => {
      visible = 'waiting';
    },
    offer: async () => false,
    ask: async () => false,
    told: () => {
      visible = 'refusal';
    },
    reopen: () => {
      visible = 'reopened';
    },
    settled: async () => {
      entered.resolve();
      await acquired.promise;
    },
    fell: async () => 'left',
  };
  const loader = new SurfaceLoader(
    new URL(`http://127.0.0.1:${port}`),
    { executable: join(bundle, 'Contents/MacOS/Electron'), env, named: false },
    window,
  );
  loaders.push(loader);
  loader.start();
  await entered.promise;
  loader.leave();
  acquired.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(visible).toBe('hidden');
});

test('an application of the standing release opens it moved, renamed, or from the kept copy once the person deleted theirs', async () => {
  const kept = installed('0.2.0');
  served = bearing('0.2.0');
  answering();
  const mine = application(join(base, 'Applications'), '0.2.0');
  const moved = join(base, 'Elsewhere', NAME);
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(mine, moved);
  const renamed = join(base, 'Elsewhere', 'Renamed.app');
  const windows = [windowOf(moved)];
  windows[0]!.loader.start();
  await until(() => windows[0]!.opened === 1);
  renameSync(moved, renamed);
  windows.push(windowOf(renamed));
  windows[1]!.loader.start();
  await until(() => windows[1]!.opened === 1);
  rmSync(renamed, { recursive: true, force: true });
  windows.push(windowOf(kept));
  windows[2]!.loader.start();
  await until(() => windows[2]!.opened === 1);

  expect(acts()).toEqual([]);
  expect(windows.flatMap((window) => window.reopened)).toEqual([]);
});

test('a window that meets its own server stalled ends that process, says why, and starts a fresh server', async () => {
  installed('0.2.0');
  served = bearing('0.2.0');
  const wedged = Bun.spawn(['/bin/sleep', '30']);
  stalled = { pid: wedged.pid, database, heldFor: 'project.birth', heldMs: 900_000, quietMs: 900_000, waiting: 2 };
  answering();
  const window = windowOf(application(join(base, 'Applications'), '0.2.0'));

  window.loader.start();
  await wedged.exited;
  await stub?.stop(true);
  stalled = null;
  await until(() => acts().includes('serve'));
  answering();
  await until(() => window.opened === 1);

  expect(wedged.signalCode).toBe('SIGKILL');
  expect(window.shown[0]).toEqual({ why: 'stalled', heldFor: 'project.birth', seconds: 900 });
  expect(acts()).toEqual(['serve']);
});

test('an older application becomes the standing one: replaced where it is writable, opened from the kept copy where not, its own release pruned or not', async () => {
  const kept = installed('0.2.0');
  const writable = application(join(base, 'Applications'), '0.1.0');
  const sealed = application(join(base, 'Volume'), '0.1.0');
  chmodSync(join(base, 'Volume'), 0o555);

  const replaced = windowOf(writable);
  replaced.loader.start();
  await until(() => replaced.reopened.length === 1);
  const opened = windowOf(sealed);
  opened.loader.start();
  await until(() => opened.reopened.length === 1);

  expect(replaced.reopened).toEqual([writable]);
  expect(carried(writable)).toBe('0.2.0');
  expect(opened.reopened).toEqual([kept]);
  expect(carried(sealed)).toBe('0.1.0');
  expect(acts()).toEqual([]);
});

test('a kept copy whose signature is broken never replaces the application: the window says so and opens as it is', async () => {
  const kept = installed('0.2.0');
  appendFileSync(join(kept, RELEASE_INSIDE, 'bin/cli/main.js'), 'damaged');
  served = bearing('0.2.0');
  answering();
  const own = application(join(base, 'Applications'), '0.1.0');
  const window = windowOf(own);

  window.loader.start();
  await until(() => window.opened === 1);

  expect(window.told).toEqual(['copy-damaged']);
  expect(window.reopened).toEqual([]);
  expect(carried(own)).toBe('0.1.0');
});

test('a window that ran on the standing release follows a step back without asking', async () => {
  installed('0.1.0');
  installed('0.2.0');
  served = bearing('0.2.0');
  answering();
  const own = application(join(base, 'Applications'), '0.2.0');
  const window = windowOf(own);
  window.loader.start();
  await until(() => window.opened === 1);

  standOn('0.1.0');
  served = bearing('0.1.0');
  window.loader.navigated();
  await until(() => window.reopened.length === 1);

  expect(window.asked).toEqual([]);
  expect(window.reopened).toEqual([own]);
  expect(carried(own)).toBe('0.1.0');
  expect(acts()).toEqual([]);
});

test('a newer application over a running server of the release before installs its own and asks that server once to restart onto it', async () => {
  installed('0.1.0');
  served = bearing('0.1.0');
  answering();
  const window = windowOf(application(join(base, 'Downloads'), '0.2.0'));

  window.loader.start();
  await until(() => window.opened === 1);
  window.loader.navigated();
  await until(() => window.opened === 1 && restarts === 1);

  expect(acts()).toEqual(['install-from']);
  expect(current()).toBe('0.2.0');
  expect(restarts).toBe(1);
  expect(served).toEqual(bearing('0.2.0'));
});

test('a newer application whose release the running server’s execution host does not take opens on that server, telling nothing and asking no restart', async () => {
  installed('0.1.0');
  served = bearing('0.1.0');
  writeFileSync(env.HELD!, '');
  answering();
  const window = windowOf(application(join(base, 'Downloads'), '0.2.0'));

  window.loader.start();
  await until(() => window.opened === 1);

  expect(acts()).toEqual(['install-from']);
  expect(current()).toBe('0.1.0');
  expect(restarts).toBe(0);
  expect(window.told).toEqual([]);
});

test.each([false, true])('after a step back a copy of the newer release asks before it installs (agreed: %p)', async (agrees) => {
  installed('0.2.0');
  installed('0.1.0');
  writeFileSync(env.ASK!, 'You went back from 0.2.0 to 0.1.0. Update to 0.2.0 again?');
  served = bearing('0.1.0');
  answering();
  const window = windowOf(application(join(base, 'Downloads'), '0.2.0'), agrees);

  window.loader.start();
  await until(() => window.opened === 1);

  expect(window.asked).toEqual(['You went back from 0.2.0 to 0.1.0. Update to 0.2.0 again?']);
  expect(acts()).toEqual(agrees ? ['install-from', 'install-from'] : ['install-from']);
  expect(current()).toBe(agrees ? '0.2.0' : '0.1.0');
  expect(restarts).toBe(agrees ? 1 : 0);
});

test('a second instance hands its newer copy to the open window, which installs it and becomes it in place', async () => {
  installed('0.1.0');
  served = bearing('0.1.0');
  answering();
  const own = application(join(base, 'Applications'), '0.1.0');
  const window = windowOf(own);
  window.loader.start();
  await until(() => window.opened === 1);

  window.loader.arrived(application(join(base, 'Downloads'), '0.2.0'));
  await until(() => window.reopened.length === 1);

  expect(acts()).toEqual(['install-from']);
  expect(current()).toBe('0.2.0');
  expect(window.reopened).toEqual([own]);
  expect(carried(own)).toBe('0.2.0');
});

test('a copy that arrives while the window is still deciding is taken up once that decision ends', async () => {
  installed('0.1.0');
  await holding();
  const own = application(join(base, 'Applications'), '0.1.0');
  const window = windowOf(own);
  window.loader.start();
  await until(() => probes() >= 1 && window.shown.some((state) => state.why === 'starting'));

  window.loader.arrived(application(join(base, 'Downloads'), '0.2.0'));
  served = bearing('0.1.0');
  answering();
  await until(() => window.reopened.length === 1);

  expect(window.opened).toBe(1);
  expect(acts()).toEqual(['install-from']);
  expect(window.reopened).toEqual([own]);
  expect(carried(own)).toBe('0.2.0');
});

test('a build of a checkout follows the server it reaches: it never asks a restart, and it reopens in the application of the build the server runs', async () => {
  const own = installed('a1b2c3d 20261014T100000Z');
  const next = installed('d4e5f6a 20261014T110000Z');
  served = bearing('a1b2c3d 20261014T100000Z');
  answering();
  const behind = windowOf(own);
  behind.loader.start();
  await until(() => behind.opened === 1);

  served = bearing('d4e5f6a 20261014T110000Z');
  behind.loader.navigated();
  await until(() => behind.reopened.length === 1);

  expect(restarts).toBe(0);
  expect(behind.reopened).toEqual([next]);
  expect(carried(own)).toBe('a1b2c3d 20261014T100000Z');
  expect(acts()).toEqual([]);
});

const attempt = (data: 'restored' | 'unrestored') =>
  writeFileSync(
    join(installRoot, ATTEMPT_FILE),
    JSON.stringify({ from: '0.1.0', to: '0.2.0', starts: 2, copied: true, ended: { detail: 'migration 7 failed', data } }),
  );

test('a release that rolled back is told to the window of the release it fell back to, and Try Again installs it once more', async () => {
  installed('0.2.0');
  installed('0.1.0');
  attempt('restored');
  served = bearing('0.1.0');
  answering();
  const own = application(join(base, 'Applications'), '0.1.0');
  const window = windowOf(own, true);

  window.loader.start();
  await until(() => window.reopened.length === 1);

  expect(window.fell.map(({ fell, build, back }) => ({ fell, build, back }))).toEqual([
    { fell: 'rolled-back', build: '0.2.0', back: '0.1.0' },
  ]);
  expect(acts()).toEqual(['install-from']);
  expect(current()).toBe('0.2.0');
  expect(window.reopened).toEqual([own]);
});

test('a server that falls back while the window cold-starts it is followed: the window decides again from the release that stands and starts it', async () => {
  installed('0.1.0');
  installed('0.2.0');
  writeFileSync(env.ROLLBACK!, '0.1.0');
  writeFileSync(env.ASK!, 'Tagma 0.2.0 did not start, so you are on 0.1.0. Try again?');
  const window = windowOf(application(join(base, 'Applications'), '0.2.0'));

  window.loader.start();
  await until(() => acts().filter((verb) => verb === 'serve').length === 2);
  served = bearing('0.1.0');
  answering();
  await until(() => window.opened === 1);

  expect(acts()).toEqual(['serve', 'install-from', 'serve']);
  expect(window.asked).toHaveLength(1);
  expect(current()).toBe('0.1.0');
});

test('a release that could not bring the data back is started to try again, says so when it still cannot, and Try Again starts it once more', async () => {
  installed('0.1.0');
  installed('0.2.0');
  attempt('unrestored');
  writeFileSync(env.UNRETURNED!, '');
  const window = windowOf(application(join(base, 'Applications'), '0.2.0'));

  window.loader.start();
  await until(() => window.shown.some((state) => state.why === 'unrestored'));
  expect(window.opened).toBe(0);
  expect(acts()).toEqual(['serve']);

  window.loader.retry();
  await until(() => acts().length === 2);
  expect(acts()).toEqual(['serve', 'serve']);
});

test('a window standing on its server that goes silent starts the release that stands, once nobody holds the data directory', async () => {
  installed('0.1.0');
  served = bearing('0.1.0');
  answering();
  const window = windowOf(application(join(base, 'Applications'), '0.1.0'));
  window.loader.start();
  await until(() => window.opened === 1);
  expect(acts()).toEqual([]);

  await stub?.stop(true);
  stub = null;
  await until(() => acts().length === 1);
  expect(acts()).toEqual(['serve']);
});

test('the window opens no server whose health names another data directory, and starts none of its own', async () => {
  installed('0.2.0');
  database = join(base, 'someone-else', 'tagma.sqlite');
  served = bearing('0.2.0');
  answering();
  const window = windowOf(application(join(base, 'Applications'), '0.2.0'));

  window.loader.start();
  await until(() => window.shown.some((state) => state.why === 'foreign'));

  expect(window.opened).toBe(0);
  expect(acts()).toEqual([]);
});

const restartRecord = (pid: number, failure: string | null = null) =>
  JSON.stringify({
    id: 'r1',
    startup: null,
    predecessor: { pid, source: { cut: null, installation: null } },
    successor: null,
    phases: [],
    points: [],
    frames: [],
    windows: [],
    failure: failure === null ? null : { at: 0, pid, detail: failure },
  });

test.each(['locked', 'handing over'])(
  'a silent address over a data directory that is %s starts no second server and waits for it',
  async (moment) => {
    installed('0.2.0');
    if (moment === 'locked') await holding();
    else writeFileSync(join(data, RESTART_RECORD), restartRecord(process.pid));
    const window = windowOf(application(join(base, 'Applications'), '0.2.0'));

    window.loader.start();
    await until(() => probes() >= 2);
    served = bearing('0.2.0');
    answering();
    await until(() => window.opened === 1);

    expect(acts()).toEqual([]);
  },
);

test('a server the window started that loses the data directory to another live server is waited out, not reported as failed', async () => {
  installed('0.2.0');
  writeFileSync(env.LOSES!, '');
  const window = windowOf(application(join(base, 'Applications'), '0.2.0'));

  window.loader.start();
  await until(() => acts().includes('serve'));
  await holding();
  writeFileSync(env.TAKEN!, '');
  await until(() => probes() >= 2);
  served = bearing('0.2.0');
  answering();
  await until(() => window.opened === 1);

  expect(window.shown.map((state) => state.why)).not.toContain('not-started');
  expect(acts()).toEqual(['serve']);
});

test('a restart the server records as failed leaves the window on the server that stays, and says so', async () => {
  installed('0.1.0');
  served = bearing('0.1.0');
  refusing = 'migration 7 failed';
  answering();
  const window = windowOf(application(join(base, 'Downloads'), '0.2.0'));

  window.loader.start();
  await until(() => window.told.length === 1);

  expect(window.told).toEqual(['restart-failed']);
  expect(restarts).toBe(1);
  expect(served).toEqual(bearing('0.1.0'));
});

test.each(['named', 'unnamed'] as const)(
  'a restart the execution host refuses opens a newer application on the server that stays; a server that names the new host it needs gets no refusal shown and no second restart on the next opening (%s)',
  async (said) => {
    installed('0.1.0');
    served = bearing('0.1.0');
    unhosting = said;
    answering();
    const bundle = application(join(base, 'Downloads'), '0.2.0');
    const first = windowOf(bundle);
    first.loader.start();
    await until(() => first.opened === 1);
    const next = windowOf(bundle);
    next.loader.start();
    await until(() => next.opened === 1);

    expect(served).toEqual(bearing('0.1.0'));
    expect(current()).toBe('0.2.0');
    expect([...first.told, ...next.told]).toEqual(said === 'named' ? [] : ['host-unprepared', 'host-unprepared']);
    expect(restarts).toBe(said === 'named' ? 1 : 2);
  },
);

test('quitting stops only the idle server of its own data directory, through the release the window carries', async () => {
  installed('0.2.0');
  const own = application(join(base, 'Applications'), '0.2.0');
  served = bearing('0.2.0');
  answering();
  const places = { installRoot, data, log: join(data, 'serve.log'), env, carried: join(own, RELEASE_INSIDE) };
  const url = new URL(`http://127.0.0.1:${port}`);

  terminals = 1;
  expect(await stopIdle(url, places)).toEqual({ stopped: false });
  terminals = 0;
  database = join(base, 'someone-else', 'tagma.sqlite');
  expect(await stopIdle(url, places)).toEqual({ stopped: false });
  expect(acts()).toEqual([]);
  database = join(data, 'tagma.sqlite');
  expect(await stopIdle(url, places)).toEqual({ stopped: true, refusal: null });
  expect(acts()).toEqual(['quit']);
  expect(lines()[0]).toContain(` ${join(own, RELEASE_INSIDE, 'bun')} `);
});

test('moving to Applications takes the first folder that is writable and never replaces an application of a newer release', async () => {
  const kept = installed('0.2.0');
  const system = join(base, 'System');
  mkdirSync(system);
  chmodSync(system, 0o555);
  const user = join(base, 'home', 'Applications');

  expect(await moveToApplications(kept, '0.2.0', [system, user])).toEqual({ placed: join(user, NAME) });
  expect(carried(join(user, NAME))).toBe('0.2.0');

  const newer = application(join(base, 'Newer'), '0.3.0');
  expect(await moveToApplications(kept, '0.2.0', [join(base, 'Newer')])).toHaveProperty('refused');
  expect(carried(newer)).toBe('0.3.0');
});
