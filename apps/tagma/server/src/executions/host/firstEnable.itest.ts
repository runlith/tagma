import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { fixtureRoot } from '../../platform/testing/roots.js';
import type { StateClaim } from './boot.js';
import { endHolderless, firstEnable, readHolderless } from './firstEnable.js';

const owned = fixtureRoot('host-first-enable', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'c-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const script = [
  '#!/bin/sh',
  'state="$2"',
  'n=$(cat "$state/.calls" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$state/.calls"',
  'cat "$state/.page$n" 2>/dev/null || true',
  'exit 0',
  '',
].join('\n');

const bundleWith = (name: string, roles: ReadonlyArray<string>) => {
  const root = join(home, name);
  const bundle = join(root, 'bundle');
  const state = join(root, 'state');
  mkdirSync(bundle, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(bundle, 'bun'), script, { mode: 0o755 });
  writeFileSync(
    join(bundle, 'artifact.json'),
    JSON.stringify({
      identity: { digest: `sha256:${'a'.repeat(64)}`, build: 'before' },
      protocol: 'executions/1',
      platform: { os: 'darwin', arch: 'arm64' },
      endpoint: { transport: 'unix', path: 'host.sock' },
      wire: { min: 1, max: 1 },
      formats: { record: 2, metadata: 1 },
      parts: roles.map((role) => ({ role, path: role, bytes: 1, digest: `sha256:${'b'.repeat(64)}` })),
    }),
  );
  return { bundle, state };
};

const enabling = Effect.fnUntraced(function* (
  world: { bundle: string; state: string },
  seen: string[],
  claim: StateClaim = { _tag: 'Free' },
) {
  return yield* firstEnable({
    files: yield* FileSystem.FileSystem,
    bundle: world.bundle,
    state: world.state,
    graceMs: 2_000,
    claim: Effect.succeed(claim),
    signalClaim: () => Effect.succeed(false),
    fence: Effect.sync(() => void seen.push('fence')),
    record: (executions) => Effect.sync(() => void seen.push(`record ${executions}`)),
  });
});

layer(BunServices.layer, { excludeTestServices: true })('first enabling', (it) => {
  it.effect('a manifest without the holder role is a bundle without a holder, whatever else it carries', () =>
    Effect.gen(function* () {
      expect((yield* readHolderless(bundleWith('before', ['runtime', 'host', 'platform']).bundle))._tag).toBe('Holderless');
      expect((yield* readHolderless(bundleWith('after', ['runtime', 'holder', 'host']).bundle))._tag).toBe('Held');
      expect((yield* readHolderless(bundleWith('named-native', ['runtime', 'host', 'native']).bundle))._tag).toBe('Holderless');
      expect((yield* readHolderless(join(home, 'nowhere')))._tag).toBe('Absent');
      const broken = bundleWith('broken', ['runtime']);
      writeFileSync(join(broken.bundle, 'artifact.json'), '{');
      expect((yield* readHolderless(broken.bundle))._tag).toBe('Unread');
    }),
  );

  it.effect('ending a bundle without a holder counts the executions it held and ends them once', () =>
    Effect.gen(function* () {
      const world = bundleWith('ends', ['runtime', 'host']);
      writeFileSync(
        join(world.state, '.page1'),
        [
          '11111111-1111-4111-8111-111111111111 5 running pty cleanup pending record available',
          '22222222-2222-4222-8222-222222222222 5 running pipes cleanup pending record available',
          '33333333-3333-4333-8333-333333333333 5 ended pty cleanup pending record available',
          '',
        ].join('\n'),
      );
      writeFileSync(join(world.state, '.page2'), 'ShutdownComplete\n');
      expect(yield* endHolderless(world)).toMatchObject({ _tag: 'Ended', executions: 2 });
    }),
  );

  it.effect('the first enabling fences, ends the holderless host, records how many ended, then leaves the raising to the caller', () =>
    Effect.gen(function* () {
      const world = bundleWith('enable', ['runtime', 'host']);
      writeFileSync(join(world.state, '.page1'), '11111111-1111-4111-8111-111111111111 5 running pty cleanup pending record available\n');
      writeFileSync(join(world.state, '.page2'), 'ShutdownComplete\n');
      const seen: string[] = [];
      expect((yield* enabling(world, seen))._tag).toBe('Enabled');
      expect(seen).toEqual(['fence', 'record 1']);
    }),
  );

  it.effect('a host whose bundle carries a holder is left alone', () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      expect((yield* enabling(bundleWith('kept', ['runtime', 'holder', 'host']), seen))._tag).toBe('NotNeeded');
      expect(seen).toEqual([]);
    }),
  );

  it.effect('an unreadable manifest or an unmeasured claim is a refusal, never an ending', () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      const broken = bundleWith('unreadable', ['runtime']);
      writeFileSync(join(broken.bundle, 'artifact.json'), '{');
      expect((yield* enabling(broken, seen))._tag).toBe('Refused');
      expect((yield* enabling({ bundle: join(home, 'nowhere'), state: join(home, 'nowhere-state') }, seen))._tag).toBe('NotNeeded');
      const world = bundleWith('unmeasured', ['runtime', 'host']);
      writeFileSync(join(world.state, '.page2'), 'ShutdownComplete\n');
      const outcome = yield* enabling(world, [], { _tag: 'Unmeasured', detail: 'lsof would not run' });
      expect(outcome._tag).toBe('Refused');
      expect(seen).toEqual([]);
    }),
  );
});
