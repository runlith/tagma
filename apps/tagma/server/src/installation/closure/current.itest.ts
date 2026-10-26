import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect } from 'effect';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { type InstallationManifest, type InstallationPart, REQUIRED_ROLES } from '../contract/wire/manifest.js';
import { identityOf } from './read.js';
import { readCurrent } from './current.js';

const owned = mkdtempSync('/tmp/tagma-standing-');
afterAll(() => rmSync(owned, { recursive: true, force: true }));

const parts: readonly InstallationPart[] = REQUIRED_ROLES.map((role) => ({
  role,
  path: `${role}/part`,
  kind: 'file' as const,
  bytes: 1,
  digest: digestOf(new TextEncoder().encode(role)),
}));

const closureAt = (name: string, build: string): string => {
  const root = join(owned, name);
  mkdirSync(root, { recursive: true });
  const platform = { os: 'darwin', arch: 'arm64' };
  const manifest: InstallationManifest = {
    version: 1,
    identity: { digest: identityOf({ platform, parts }), build },
    platform,
    parts,
  };
  writeFileSync(join(root, 'install.json'), JSON.stringify(manifest));
  return root;
};

const checkoutAt = (name: string): string => {
  const root = join(owned, name);
  mkdirSync(root, { recursive: true });
  return root;
};

const brokenAt = (name: string): string => {
  const root = join(owned, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'install.json'),
    JSON.stringify({
      version: 1,
      identity: { digest: digestOf(new TextEncoder().encode('not this')), build: 'broken' },
      platform: { os: 'darwin', arch: 'arm64' },
      parts,
    }),
  );
  return root;
};

const stood = (entry: string, installed: string) => Effect.result(Effect.provide(readCurrent(entry, installed), BunFileSystem.layer));

it.live('a process whose entry stands in a closure IS that installation and hands out its own parts', () =>
  Effect.gen(function* () {
    const entry = closureAt('own-entry', 'abc1234 20260101T000000000Z');
    const machine = closureAt('other-machine', 'zzz9999 20260202T000000000Z');

    const read = yield* stood(entry, machine);

    expect(read._tag).toBe('Success');
    const standing = read._tag === 'Success' ? read.success : null;
    expect(standing?.runsFrom?.root).toBe(entry);
    expect(standing?.handsOut?.manifest.identity.build).toBe('abc1234 20260101T000000000Z');
  }),
);

it.live('a process whose entry stands in a checkout runs no closure and hands out the machine’s installation', () =>
  Effect.gen(function* () {
    const entry = checkoutAt('own-checkout');
    const machine = closureAt('machine', 'def5678 20260303T000000000Z');

    const read = yield* stood(entry, machine);

    const standing = read._tag === 'Success' ? read.success : null;
    expect(standing?.runsFrom).toBeUndefined();
    expect(standing?.handsOut?.root).toBe(machine);
    expect(standing?.unreadable).toBeUndefined();
  }),
);

it.live('a broken closure beside the entry refuses, and one at the install root is carried rather than read as an empty machine', () =>
  Effect.gen(function* () {
    const entry = checkoutAt('checkout-with-broken-machine');

    const empty = yield* stood(entry, checkoutAt('nothing-installed'));
    expect(empty._tag === 'Success' ? empty.success.unreadable : 'read').toBeUndefined();
    const carried = yield* stood(entry, brokenAt('broken-machine'));
    expect(carried._tag === 'Success' ? carried.success.unreadable?._tag : null).toBe('InstallationInvalid');
    expect(carried._tag === 'Success' ? carried.success.handsOut : 'stands').toBeUndefined();

    const refused = yield* stood(brokenAt('broken-entry'), checkoutAt('nothing-installed-either'));
    expect(refused._tag).toBe('Failure');
    expect(refused._tag === 'Failure' ? refused.failure._tag : null).toBe('InstallationInvalid');
  }),
);
