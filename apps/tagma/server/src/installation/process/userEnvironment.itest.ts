import { afterAll, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { it } from '@runlith/effect-test';
import { LAUNCH_PATH, PROFILE_PATHS, type ProfileRead, type UserShell } from '../contract/service/userEnvironment.js';
import { WORLD_COMMAND } from '../contract/wire/layout.js';
import { makeUserEnvironment } from './userEnvironment.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'user-environment-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const dir = (name: string) => {
  const at = join(root, name);
  mkdirSync(at, { recursive: true });
  return at;
};
const world = dir('world');
writeFileSync(join(world, WORLD_COMMAND), '#!/bin/sh\n', { mode: 0o755 });
const managers = dir('managers');
const fallback = dir('fallback');
const profileDir = dir('profile');
const SYSTEM = '/usr/bin:/bin:/usr/sbin:/sbin';

const shellOf = (answers: (() => Promise<ProfileRead>)[]) => {
  let asked = 0;
  const shell: UserShell = {
    desktopLaunch: (path) => path === SYSTEM,
    managers: () => [managers],
    fallback: () => [fallback],
    runtimes: () => [],
    read: () => {
      asked += 1;
      return answers.shift()!();
    },
  };
  return { shell, asked: () => asked };
};
const later = () => {
  let give: (read: ProfileRead) => void = () => undefined;
  const answer = new Promise<ProfileRead>((resolved) => {
    give = resolved;
  });
  return { answer: () => answer, give: (read: ProfileRead) => give(read) };
};
const read = (entries: readonly string[]) => async (): Promise<ProfileRead> => ({ outcome: 'read', entries, detail: null });

it.live(
  'a desktop launch stands world, version managers, launch PATH and fallback before the profile answers, and the profile leads once read',
  () =>
    Effect.gen(function* () {
      const pending = later();
      const { shell } = shellOf([pending.answer]);
      const env: NodeJS.ProcessEnv = { PATH: SYSTEM };
      const users = makeUserEnvironment({ shell, env, world, home: root });
      expect(env.PATH).toBe([world, managers, ...SYSTEM.split(':'), fallback].join(':'));
      expect(yield* users.now).toMatchObject({ profile: null, reading: true });
      const waiters = yield* Effect.forkChild(Effect.all([users.ready, users.ready], { concurrency: 'unbounded' }));
      yield* Effect.yieldNow;
      pending.give({ outcome: 'read', entries: [profileDir, '/usr/bin'], detail: null });
      const answered = yield* Fiber.join(waiters);
      expect(answered.map((paths) => [paths.profile?.outcome, paths.reading])).toEqual([
        ['read', false],
        ['read', false],
      ]);
      expect(env.PATH).toBe([world, profileDir, '/usr/bin', managers, '/bin', '/usr/sbin', '/sbin', fallback].join(':'));
    }),
);

it.live('a profile that times out leaves the world first and the user directories reachable without it', () =>
  Effect.gen(function* () {
    const { shell } = shellOf([async () => ({ outcome: 'timeout', entries: [], detail: 'slow' })]);
    const env: NodeJS.ProcessEnv = { PATH: SYSTEM };
    const users = makeUserEnvironment({ shell, env, world, home: root });
    expect((yield* users.ready).profile?.outcome).toBe('timeout');
    expect(env.PATH).toBe([world, managers, ...SYSTEM.split(':'), fallback].join(':'));
  }),
);

it.live('a refresh rebuilds PATH from its parts, so an entry the profile stopped naming leaves', () =>
  Effect.gen(function* () {
    const gone = dir('gone');
    const { shell } = shellOf([read([gone]), read([profileDir])]);
    const env: NodeJS.ProcessEnv = { PATH: SYSTEM };
    const users = makeUserEnvironment({ shell, env, world, home: root });
    yield* users.ready;
    expect(env.PATH?.split(':')).toContain(gone);
    yield* users.refresh;
    expect(env.PATH?.split(':')).not.toContain(gone);
    expect(env.PATH?.split(':')[1]).toBe(profileDir);
  }),
);

it.live('a launch PATH the caller chose is kept as given, with no profile and no added directories', () =>
  Effect.gen(function* () {
    const chosen = dir('chosen');
    const { shell, asked } = shellOf([]);
    const env: NodeJS.ProcessEnv = { PATH: `.:./node_modules/.bin:${chosen}:/usr/bin` };
    const users = makeUserEnvironment({ shell, env, world, home: root });
    expect((yield* users.ready).profile?.outcome).toBe('not-needed');
    expect(env.PATH).toBe([world, '.', './node_modules/.bin', chosen, '/usr/bin'].join(':'));
    expect(asked()).toBe(0);
  }),
);

it.live('a successor handed a read profile is ready at once without asking the shell, and the handoff leaves its own environment', () =>
  Effect.gen(function* () {
    const first = shellOf([read([profileDir])]);
    const predecessor = makeUserEnvironment({ shell: first.shell, env: { PATH: SYSTEM }, world, home: root });
    yield* predecessor.ready;
    const next = shellOf([]);
    const env: NodeJS.ProcessEnv = { PATH: 'whatever:the:predecessor:built', ...predecessor.handoff() };
    const successor = makeUserEnvironment({ shell: next.shell, env, world, home: root });
    expect((yield* successor.ready).profile?.entries).toEqual([profileDir]);
    expect(next.asked()).toBe(0);
    expect(env[LAUNCH_PATH]).toBeUndefined();
    expect(env[PROFILE_PATHS]).toBeUndefined();
    expect(env.PATH?.split(':')[1]).toBe(profileDir);
  }),
);

it.live('a successor handed directories of a profile whose last refresh failed keeps them and reads the profile again', () =>
  Effect.gen(function* () {
    const first = shellOf([read([profileDir]), async () => ({ outcome: 'timeout', entries: [], detail: null })]);
    const predecessor = makeUserEnvironment({ shell: first.shell, env: { PATH: SYSTEM }, world, home: root });
    yield* predecessor.ready;
    expect((yield* predecessor.refresh).profile).toMatchObject({ outcome: 'timeout', entries: [profileDir] });
    const pending = later();
    const next = shellOf([pending.answer]);
    const env: NodeJS.ProcessEnv = { PATH: SYSTEM, ...predecessor.handoff() };
    const successor = makeUserEnvironment({ shell: next.shell, env, world, home: root });
    expect(next.asked()).toBe(1);
    expect(env.PATH?.split(':')[1]).toBe(profileDir);
    pending.give({ outcome: 'read', entries: [profileDir], detail: null });
    expect((yield* successor.ready).profile?.outcome).toBe('read');
  }),
);

it.live('locate answers every executable match on PATH and in the given directories once per real file', () =>
  Effect.gen(function* () {
    const a = dir('locate-a');
    const b = dir('locate-b');
    writeFileSync(join(a, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(b, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(b, 'plain'), 'not executable', { mode: 0o644 });
    const { shell } = shellOf([]);
    const users = makeUserEnvironment({ shell, env: { PATH: `${a}:/usr/bin` }, world: null, home: root });
    expect(yield* users.locate('tool', [b, a])).toEqual([join(a, 'tool'), join(b, 'tool')]);
    expect(yield* users.locate('plain', [b])).toEqual([]);
    expect(yield* users.locate(join(b, 'tool'), [a])).toEqual([join(b, 'tool')]);
    expect(yield* users.locate(join(b, 'plain'), [a])).toEqual([]);
  }),
);
