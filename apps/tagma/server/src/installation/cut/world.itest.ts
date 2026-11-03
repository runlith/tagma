import { afterAll, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { LOCK_FILE } from '../../platform/contract/wire/lock.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testProcesses } from '../testing/processes.js';
import { pathToFileURL } from 'node:url';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { CHANNELS } from '../contract/wire/channel.js';
import type { FeedRelease } from '../contract/wire/feed.js';
import { observedSettled, updated, type World } from './world.js';

const dir = mkdtempSync(join(tmpdir(), 'release-waits-'));
let configured = '';
let readNext = (): unknown => ({ offers: [], issue: null, readFrom: configured });
let readTerminal = (): unknown => ({ code: 'terminal-unknown', reason: 'execution absent' });
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/health') return Response.json({ ok: true, source: { installation: { build: '0.2.0' } } });
    if (path === '/api/op/write_setting') {
      const body = (await request.json()) as { value: string };
      configured = body.value;
      return Response.json({ status: 'written' });
    }
    if (path === '/api/op/read_machine_state') return Response.json({ machine: { server: { next: readNext() } } });
    if (path === '/api/op/install_next') return Response.json({ code: 'installation-stopped', reason: 'the offer reached installation' });
    if (path === '/api/op/read_terminal') return Response.json(readTerminal());
    if (path === '/api/op/read_terminal_bytes') {
      return Response.json({ range: { next: '0', retainedFrom: '0', durableThrough: '0', gap: false }, bytes: '' });
    }
    if (path === '/api/op/speech_status') return Response.json({ speech: { devices: { availability: { _tag: 'present' } } } });
    return new Response('Not Found', { status: 404 });
  },
});
const world: World = {
  channel: CHANNELS.stable,
  dir,
  env: { PATH: '/usr/bin:/bin' },
  url: `http://127.0.0.1:${server.port}`,
  installRoot: join(dir, 'install'),
  data: join(dir, 'data'),
  repo: dir,
  processes: testProcesses,
};
const offer: FeedRelease = {
  release: '0.2.0',
  platforms: { 'darwin-arm64': { archive: 'file:///release.tar.gz', sha256: '1'.repeat(64), size: 0 } },
  irreversible: false,
  stores: { 'machine-store': [], 'host-store': [], graph: [], journal: [] },
  changes: [],
};
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

it.live('an offer wait ignores an issue from a different feed and ends on the configured feed check failure', () =>
  Effect.gen(function* () {
    let checked = false;
    readNext = () => {
      if (!checked) {
        checked = true;
        return { offers: [], issue: { code: 'offline', reason: 'another feed' }, readFrom: 'file:///another-feed.json' };
      }
      return { offers: [], issue: { code: 'source-unreadable', reason: 'the configured feed is unreadable' }, readFrom: configured };
    };
    const outcome = yield* Effect.promise(() => updated(world, offer));
    expect(outcome).toContain('source-unreadable');
  }),
);

it.live('a completed check with no offered release ends the trial without asking for an installation', () =>
  Effect.gen(function* () {
    readNext = () => ({ offers: [], issue: null, readFrom: configured });
    const outcome = yield* Effect.promise(() => updated(world, offer));
    expect(outcome).toContain(offer.release);
    expect(outcome).toContain(pathToFileURL(join(dir, 'feed.json')).href);
  }),
);

it.live('a terminal with no host state ends its wait when no flock holder or live handover exists', () =>
  Effect.gen(function* () {
    mkdirSync(world.data, { recursive: true });
    writeFileSync(join(world.data, LOCK_FILE), String(process.pid));
    readTerminal = () => ({ state: null });
    const seen = yield* Effect.promise(() =>
      observedSettled(world, {
        pipes: { execution: 'pipes', incarnation: 1 },
        pty: { execution: 'pty', incarnation: 1 },
      }),
    );
    expect(seen.terminals?.waited).toEqual({ ms: expect.any(Number), meanwhile: expect.any(String) });
  }),
);

it.live('terminal readiness ends on a definite refusal and retains that cause in the measured wait', () =>
  Effect.gen(function* () {
    readTerminal = () => ({ code: 'terminal-unknown', reason: 'execution absent' });
    const seen = yield* Effect.promise(() =>
      observedSettled(world, {
        pipes: { execution: 'pipes', incarnation: 1 },
        pty: { execution: 'pty', incarnation: 1 },
      }),
    );
    expect(seen.terminals?.waited?.meanwhile).toContain('terminal-unknown');
    expect(seen.terminals?.waited?.ms).toBeGreaterThanOrEqual(0);
  }),
);
