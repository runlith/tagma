import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { CHANNELS } from '../contract/wire/channel.js';
import { ACTIVE_FILE, type ActiveServer, entryPath, junctionDirectory } from '../contract/wire/junction.js';
import { activeElsewhere, activeHolder, takeActive } from './active.js';
import { placeEntry } from './entry.js';
import { switchFrom } from './switch.js';

const SERVER = new URL('../../../', import.meta.url).pathname;
const LOCK = new URL('./active.ts', import.meta.url).href;

let home: string;
let junction: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tagma-junction-'));
  junction = junctionDirectory({ HOME: home })!;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const fakeCli = (name: string, shutdown = '{"_tag":"ShutdownComplete"}'): string => {
  const path = join(home, name);
  writeFileSync(
    path,
    `#!/bin/sh\necho "${name} $*" >> "${home}/said"\nif [ "$1" = execution-host ]; then echo '${shutdown}'; exit 0; fi\necho "${name} $*"\n`,
  );
  chmodSync(path, 0o755);
  return path;
};

const holding = async (record: Omit<ActiveServer, 'pid'>) => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { takeActive } from ${JSON.stringify(LOCK)};
       const taken = takeActive(${JSON.stringify(junction)}, { ...${JSON.stringify(record)}, pid: process.pid });
       process.on('SIGTERM', () => { taken.release(); process.exit(0); });
       console.log(taken._tag);
       await Bun.sleep(30_000);`,
    ],
    { cwd: SERVER, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' },
  );
  const reader = child.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(value).trim()).toBe('Taken');
  return child;
};

const entry = (...args: string[]) => {
  const ran = Bun.spawnSync([entryPath({ HOME: home })!, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { code: ran.exitCode, out: ran.stdout.toString().trim(), err: ran.stderr.toString() };
};

it.live('a running channel refuses the other by name and address, and its kill -9 hands the Mac over', () =>
  Effect.gen(function* () {
    const dev = yield* Effect.promise(() => holding({ channel: 'dev', cli: '/nowhere/tagma', url: 'http://127.0.0.1:5633' }));
    expect(activeElsewhere(CHANNELS.stable, { HOME: home })).toEqual({
      channel: 'dev',
      cli: '/nowhere/tagma',
      url: 'http://127.0.0.1:5633',
      pid: dev.pid,
    });
    expect(activeElsewhere(CHANNELS.dev, { HOME: home })).toBeNull();
    const own = { channel: 'stable', cli: '/nowhere/tagma', url: 'http://127.0.0.1:5643', pid: process.pid };
    expect(takeActive(junction, own)).toMatchObject({ _tag: 'Held', holder: { channel: 'dev', pid: dev.pid } });

    dev.kill('SIGKILL');
    yield* Effect.promise(() => dev.exited);
    const taken = takeActive(junction, own);
    expect(taken._tag).toBe('Taken');
    expect(activeElsewhere(CHANNELS.dev, { HOME: home })).toMatchObject({ channel: 'stable', pid: process.pid });
    if (taken._tag === 'Taken') taken.release();
    expect(existsSync(join(junction, ACTIVE_FILE))).toBe(false);
    expect(activeHolder(junction)).toBeNull();
  }),
);

it.live('switching asks the running channel to leave, waits for its lock, and ends its execution host', () =>
  Effect.gen(function* () {
    const cli = fakeCli('dev-cli');
    const dev = yield* Effect.promise(() => holding({ channel: 'dev', cli, url: 'http://127.0.0.1:5633' }));
    const holder = activeElsewhere(CHANNELS.stable, { HOME: home });
    expect(holder).not.toBeNull();

    const switched = yield* switchFrom(holder!, { HOME: home });

    expect(yield* Effect.promise(() => dev.exited)).toBe(0);
    expect(switched.from).toBe(CHANNELS.dev.name);
    expect(readFileSync(join(home, 'said'), 'utf8')).toMatch(/^dev-cli execution-host shutdown --operation=switch-\d+ --json\n$/);
    expect(activeHolder(junction)).toBeNull();
  }),
);

it.live('a switch whose execution host did not end is refused, so nothing starts over terminals still running', () =>
  Effect.gen(function* () {
    const cli = fakeCli('dev-cli', '{"_tag":"ShutdownIncomplete","reason":"a terminal stayed"}');
    const dev = yield* Effect.promise(() => holding({ channel: 'dev', cli, url: 'http://127.0.0.1:5633' }));

    const refused = yield* Effect.flip(switchFrom(activeElsewhere(CHANNELS.stable, { HOME: home })!, { HOME: home }));

    expect(yield* Effect.promise(() => dev.exited)).toBe(0);
    expect(refused.code).toBe('host-stayed');
  }),
);

test('the entry point reaches whichever channel is active, and a hook without one leaves quietly', () => {
  expect(placeEntry({ HOME: home })._tag).toBe('Placed');
  expect(placeEntry({ HOME: home })._tag).toBe('Standing');

  expect(entry('hook', 'stop')).toEqual({ code: 0, out: '', err: '' });
  expect(entry('mcp-serve').code).toBe(1);
  writeFileSync(
    join(junction, ACTIVE_FILE),
    `${JSON.stringify({ channel: 'dev', cli: fakeCli('gone-cli'), url: 'http://127.0.0.1:5633', pid: 2 ** 22 + 1 })}\n`,
  );
  expect(entry('hook', 'stop')).toEqual({ code: 0, out: '', err: '' });

  for (const [channel, url] of [
    ['dev', 'http://127.0.0.1:5633'],
    ['stable', 'http://127.0.0.1:5643'],
  ] as const) {
    const cli = fakeCli(`${channel}-cli`);
    const taken = takeActive(junction, { channel, cli, url, pid: process.pid });
    expect(entry('hook', 'stop', '--harness', 'codex')).toEqual({ code: 0, out: `${channel}-cli hook stop --harness codex`, err: '' });
    expect(entry('mcp-serve', '--harness', 'claude-code')).toEqual({
      code: 0,
      out: `${channel}-cli mcp-serve --harness claude-code`,
      err: '',
    });
    if (taken._tag === 'Taken') taken.release();
  }
});
