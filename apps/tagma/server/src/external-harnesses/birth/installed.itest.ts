import { afterAll, expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { it } from '@runlith/effect-test';
import { type ProfileRead, UserEnvironment, type UserShell } from '../../installation/contract/service/userEnvironment.js';
import { makeUserEnvironment, type EnvironmentInput } from '../../installation/process/userEnvironment.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import type { HarnessInstall } from '../../threads/contract/wire/harness/externalSession.js';
import { installedHarnessesWith } from './installed.js';
import type { Terminals, TerminalStart } from '../../executions/contract/service/terminals.js';
import { WORLD_COMMAND } from '../../installation/contract/wire/layout.js';
import { HARNESS_PROGRAM } from '../contract/wire/program.js';
import { harnessTerminals } from '../sessions/programs.js';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { NamespaceId } from '@runlith/files/namespace';
import { TargetKey } from '../../executions/contract/wire/targets.js';
import { EnvironmentId } from '../../workspace/contract/wire/environments.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'installed-harnesses-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SYSTEM = '/usr/bin:/bin:/usr/sbin:/sbin';

const script = (path: string, body: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body, { mode: 0o755 });
};
const answering = (said: string) => `#!/bin/sh\necho '${said}'\n`;

const homeOf = (name: string) => {
  const home = join(root, name);
  const local = join(home, '.local', 'bin');
  const nvm = (version: string) => join(home, '.nvm', 'versions', 'node', version, 'bin');
  mkdirSync(local, { recursive: true });
  return { home, local, nvm };
};

const shellFor = (fallback: string, runtimes: readonly string[], profile: () => Promise<ProfileRead>): UserShell => ({
  desktopLaunch: (path) => path === SYSTEM,
  managers: () => [],
  fallback: () => [fallback],
  runtimes: () => runtimes,
  read: profile,
});

const machine = (home: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const kept = { PATH: process.env.PATH, HOME: process.env.HOME };
      process.env.PATH = SYSTEM;
      process.env.HOME = home;
      return kept;
    }),
    (kept) =>
      Effect.sync(() => {
        process.env.PATH = kept.PATH;
        process.env.HOME = kept.HOME;
      }),
  );

const installsOver = (users: UserEnvironment['Service'], budgetMs = 5_000) =>
  Effect.map(
    Layer.build(
      installedHarnessesWith(budgetMs).pipe(Layer.provide(Layer.merge(BunFileSystem.layer, Layer.succeed(UserEnvironment, users)))),
    ),
    (context) => Context.get(context, InstalledHarnesses),
  );
const counting = (log: string, said: string) => `#!/bin/sh\necho x >> '${log}'\necho '${said}'\n`;
const runs = (log: string): number => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);

const failedProfile = async (): Promise<ProfileRead> => ({ outcome: 'timeout', entries: [], detail: 'did not answer' });
const isolatedUsers = (input: EnvironmentInput) => {
  const users = makeUserEnvironment(input);
  return UserEnvironment.of({
    ...users,
    locate: (name, dirs) => Effect.map(users.locate(name, dirs), (found) => found.filter((path) => path.startsWith(`${root}/`))),
  });
};

const spawnsOf = (binary: string, seen: (child: ReturnType<typeof Bun.spawn>) => void = () => undefined) =>
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => {
        const previous = Bun.spawn;
        const children: ReturnType<typeof Bun.spawn>[] = [];
        const observed: typeof Bun.spawn = (...args: readonly unknown[]) => {
          const child = Reflect.apply(previous, Bun, args);
          if (Array.isArray(args[0]) && args[0][0] === binary) {
            children.push(child);
            seen(child);
          }
          return child;
        };
        Bun.spawn = observed;
        return { previous, children };
      }),
      ({ previous, children }) =>
        Effect.promise(async () => {
          Bun.spawn = previous;
          for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
          await Promise.all(children.map((child) => child.exited));
        }),
    ),
    ({ children }) => children,
  );

it.effect('a probe still running when its reader leaves is reaped when the layer closes', () =>
  Effect.gen(function* () {
    const { home, local } = homeOf('interrupted');
    yield* machine(home);
    const binary = join(local, 'grok');
    script(binary, '#!/bin/sh\nexec /bin/sleep 5\n');
    const users = isolatedUsers({ shell: shellFor(local, [], failedProfile), env: process.env, world: null, home });
    yield* users.ready;
    const started = yield* Effect.acquireRelease(Queue.unbounded<number>(), Queue.shutdown);
    yield* spawnsOf(binary, (child) => Queue.offerUnsafe(started, child.pid));
    const pid = yield* Effect.scoped(
      Effect.gen(function* () {
        const installs = yield* installsOver(users);
        const checking = yield* Effect.forkScoped(installs.program('grok'));
        const pid = yield* Queue.take(started);
        yield* Fiber.interrupt(checking);
        return pid;
      }),
    );
    const standing = yield* Effect.result(Effect.try({ try: () => process.kill(pid, 0), catch: (cause) => cause }));
    expect(standing).toMatchObject({ _tag: 'Failure', failure: { code: 'ESRCH' } });
  }),
);

it.effect('listing and refreshing locate executable files without running them; selecting one proves only its version', () =>
  Effect.gen(function* () {
    const { home, local } = homeOf('passive');
    yield* machine(home);
    const log = join(home, 'grok.log');
    const other = join(home, 'devin.log');
    const binary = join(local, 'grok');
    script(binary, counting(log, 'grok 1.0.52'));
    script(join(local, 'devin'), counting(other, 'devin 3000.11.3'));
    const users = isolatedUsers({ shell: shellFor(local, [], failedProfile), env: process.env, world: null, home });
    yield* users.ready;
    const installs = yield* installsOver(users);
    yield* installs.read;
    yield* installs.settled;
    const refreshed = yield* installs.refresh;
    expect(runs(log)).toBe(0);
    expect(runs(other)).toBe(0);
    expect(refreshed.find((row) => row.harness === 'grok')).toMatchObject({ binary, version: null, searching: false });
    expect(yield* installs.program('grok')).toEqual({ path: binary, runtime: null });
    expect((yield* installs.read).find((row) => row.harness === 'grok')).toMatchObject({ binary, version: 'grok 1.0.52' });
    expect(runs(log)).toBe(1);
    expect(runs(other)).toBe(0);
  }),
);

const grokOnChange = (installs: InstalledHarnesses['Service'], settled: (row: HarnessInstall | undefined) => boolean) =>
  installs.changes.pipe(
    Stream.mapEffect(() => installs.read),
    Stream.map((rows) => rows.find((row) => row.harness === 'grok')),
    Stream.filter(settled),
    Stream.runHead,
  );

it.effect('a deleted CLI stops reading as installed, and its missing row arrives as a change', () =>
  Effect.gen(function* () {
    const { home, local } = homeOf('deleted');
    yield* machine(home);
    const binary = join(local, 'grok');
    script(binary, answering('grok 1.0.50'));
    const users = isolatedUsers({ shell: shellFor(local, [], failedProfile), env: process.env, world: null, home });
    yield* users.ready;
    const installs = yield* installsOver(users);
    expect((yield* installs.settled).find((row) => row.harness === 'grok')).toMatchObject({ binary });
    const next = yield* Stream.toPull(installs.changes);
    yield* next;
    rmSync(binary);
    expect((yield* installs.read).find((row) => row.harness === 'grok')).toMatchObject({ binary: null });
    yield* next;
    expect((yield* installs.read).find((row) => row.harness === 'grok')).toMatchObject({ binary: null, searching: false });
  }),
);

it.effect('rewriting an executable invalidates its proven version until the next explicit selection', () =>
  Effect.gen(function* () {
    const { home, local } = homeOf('rewritten');
    yield* machine(home);
    const binary = join(local, 'grok');
    const log = join(home, 'runs.log');
    script(binary, counting(log, 'grok 1.0.52'));
    const users = isolatedUsers({ shell: shellFor(local, [], failedProfile), env: process.env, world: null, home });
    yield* users.ready;
    const installs = yield* installsOver(users);
    yield* installs.program('grok');
    expect((yield* installs.read).find((row) => row.harness === 'grok')).toMatchObject({ version: 'grok 1.0.52' });
    script(binary, counting(log, 'grok 1.0.53'));
    expect((yield* installs.read).find((row) => row.harness === 'grok')).toMatchObject({ binary, version: null, searching: false });
    expect(runs(log)).toBe(1);
    yield* installs.program('grok');
    const answered = yield* grokOnChange(installs, (row) => row?.version === 'grok 1.0.53');
    expect(answered).toMatchObject({ _tag: 'Some', value: { binary, version: 'grok 1.0.53', searching: false } });
  }),
);

it.effect(
  'with a system PATH and a profile that never answered, each CLI is found where it was installed and the dead copy first on PATH is passed over',
  () =>
    Effect.gen(function* () {
      const { home, local, nvm } = homeOf('found');
      yield* machine(home);
      script(join(home, '.claude', 'local', 'claude'), answering('2.1.300 (Claude Code)'));
      script(join(local, 'grok'), answering('grok 1.0.50'));
      script(join(nvm('v20.1.0'), 'codex'), '#!/usr/bin/env node\n');
      script(join(nvm('v20.1.0'), 'node'), answering('codex-cli 0.159.0'));
      const dead = join(root, 'found-dead');
      script(join(dead, 'devin'), '#!/bin/sh\nexit 3\n');
      script(join(local, 'devin'), answering('devin 3000.11.3'));
      const users = isolatedUsers({
        shell: shellFor(local, [nvm('v20.1.0')], failedProfile),
        env: process.env,
        world: null,
        home,
      });
      yield* users.ready;
      process.env.PATH = `${dead}:${process.env.PATH}`;
      const installs = yield* installsOver(users);
      const located = new Map((yield* installs.settled).map((row) => [row.harness, row]));
      expect(located.get('devin')).toMatchObject({ binary: join(dead, 'devin'), version: null });
      for (const name of ['claude', 'grok', 'codex', 'devin']) yield* installs.program(name);
      const rows = new Map((yield* installs.read).map((row) => [row.harness, row]));

      expect(rows.get('claude-code')).toMatchObject({ binary: join(home, '.claude', 'local', 'claude'), version: '2.1.300 (Claude Code)' });
      expect(rows.get('grok')).toMatchObject({ binary: join(local, 'grok'), version: 'grok 1.0.50' });
      expect(rows.get('codex')).toMatchObject({ binary: join(nvm('v20.1.0'), 'codex'), version: 'codex-cli 0.159.0' });
      expect(rows.get('devin')).toMatchObject({ binary: join(local, 'devin'), version: 'devin 3000.11.3' });
      expect(yield* installs.program('codex')).toEqual({ path: join(nvm('v20.1.0'), 'codex'), runtime: nvm('v20.1.0') });
      expect(yield* installs.program('grok')).toEqual({ path: join(local, 'grok'), runtime: null });
      expect(rows.get('gemini')).toMatchObject({ binary: null, searching: false });
      const started: TerminalStart[] = [];
      const terminals = {
        start: (request: TerminalStart) => Effect.sync(() => (started.push(request), { _tag: 'Refused' })),
      } as unknown as Terminals['Service'];
      const wrapped = harnessTerminals(terminals, installs);
      const namespaceId = NamespaceId.make('program-test');
      const witness = { provider: 'test', format: 'test', token: 'program-test' };
      const launch = (program: string, args: readonly string[]): TerminalStart => ({
        program,
        args,
        actor: { _tag: 'Operator' },
        operationId: HostRequestKey.make('program-test'),
        transport: 'pipes',
        lifetime: 'call',
        targetKey: TargetKey.make('program-test'),
        target: {
          projectId: 1,
          binding: { environmentId: EnvironmentId.make('program-test'), kind: 'host', namespaceId, identityWitness: witness },
          footprint: { status: 'complete', resource: { namespaceId, path: home }, witness, registryRevision: 0, roots: [] },
        },
      });
      yield* wrapped.start(launch(WORLD_COMMAND, ['harness-run', 'claude-code']));
      yield* wrapped.start(launch('claude', []));
      expect(started[0]?.environment?.entries).toEqual([
        { _tag: 'Set', name: HARNESS_PROGRAM, value: join(home, '.claude', 'local', 'claude') },
      ]);
      expect(started[1]?.program).toBe(join(home, '.claude', 'local', 'claude'));
      expect(yield* installs.program('claude-code')).toBeNull();
    }),
);

it.effect(
  'a CLI installed after the first reading is found by refresh, and a missing one waits for the profile before it is told missing',
  () =>
    Effect.gen(function* () {
      const { home, local } = homeOf('later');
      yield* machine(home);
      let answer: (read: ProfileRead) => void = () => undefined;
      const pending = new Promise<ProfileRead>((resolved) => {
        answer = resolved;
      });
      const asked = [() => pending, failedProfile];
      const users = isolatedUsers({
        shell: shellFor(local, [], () => asked.shift()!()),
        env: process.env,
        world: null,
        home,
      });
      const installs = yield* installsOver(users);
      const first = (yield* installs.read).find((row) => row.harness === 'cursor');
      expect(first).toMatchObject({ binary: null, searching: true, serves: 'cursor' });
      answer({ outcome: 'timeout', entries: [], detail: null });
      expect((yield* installs.settled).find((row) => row.harness === 'cursor')).toMatchObject({ binary: null, searching: false });

      script(join(local, 'cursor-agent'), answering('2026.10.01-e373342'));
      const refreshed = (yield* installs.refresh).find((row) => row.harness === 'cursor');
      expect(refreshed).toMatchObject({ binary: join(local, 'cursor-agent'), version: null });
    }),
);

it.effect(
  'a hung first copy yields to an answering second, and a lone hung copy stays found with its version unread, each probed once',
  () =>
    Effect.gen(function* () {
      const { home, local } = homeOf('hung');
      yield* machine(home);
      const early = join(root, 'hung-early');
      script(join(early, 'grok'), `#!/bin/sh\nexec /bin/sleep 5\n`);
      script(join(local, 'grok'), answering('grok 1.0.50'));
      script(join(early, 'gemini'), '#!/bin/sh\nexec /bin/sleep 5\n');
      const users = isolatedUsers({ shell: shellFor(local, [], failedProfile), env: process.env, world: null, home });
      yield* users.ready;
      process.env.PATH = `${early}:${process.env.PATH}`;
      const hung = yield* Effect.acquireRelease(Queue.unbounded<number>(), Queue.shutdown);
      const hungGrok = yield* spawnsOf(join(early, 'grok'), (child) => Queue.offerUnsafe(hung, child.pid));
      const hungGemini = yield* spawnsOf(join(early, 'gemini'), (child) => Queue.offerUnsafe(hung, child.pid));
      const installs = yield* installsOver(users, 1_000);
      const outwaited = Effect.fnUntraced(function* (name: string) {
        const probing = yield* Effect.forkScoped(installs.program(name));
        yield* Queue.take(hung);
        yield* TestClock.adjust('1 second');
        return yield* Fiber.join(probing);
      });
      yield* outwaited('grok');
      yield* outwaited('gemini');
      const rows = new Map((yield* installs.read).map((row) => [row.harness, row]));
      expect(rows.get('grok')).toMatchObject({ binary: join(local, 'grok'), version: 'grok 1.0.50' });
      expect(rows.get('gemini')).toMatchObject({ binary: join(early, 'gemini'), version: null });
      expect(yield* installs.program('gemini')).toEqual({ path: join(early, 'gemini'), runtime: null });
      yield* installs.program('grok');
      yield* installs.read;
      expect([hungGrok.length, hungGemini.length]).toEqual([1, 1]);
    }),
);

it.effect(
  'concurrent readers share one probe, a failed probe is not repeated on the same PATH, and is tried again once PATH gives it its runtime',
  () =>
    Effect.gen(function* () {
      const { home, local } = homeOf('shared');
      yield* machine(home);
      const log = join(root, 'shared.log');
      const runtime = join(root, 'shared-runtime');
      script(join(local, 'devin'), counting(log, 'devin 3000.11.3'));
      script(join(local, 'codex'), '#!/usr/bin/env tagma-test-runtime\n');
      script(join(runtime, 'tagma-test-runtime'), counting(log, 'codex-cli 0.162.0'));
      const users = isolatedUsers({ shell: shellFor(local, [], failedProfile), env: process.env, world: null, home });
      yield* users.ready;
      const installs = yield* installsOver(users);
      yield* Effect.all([installs.read, installs.read, installs.program('devin'), installs.settled], { concurrency: 'unbounded' });
      expect(runs(log)).toBe(1);
      expect(yield* installs.program('codex')).toBeNull();
      expect((yield* installs.read).find((row) => row.harness === 'codex')).toMatchObject({ binary: join(local, 'codex'), version: null });
      expect(runs(log)).toBe(1);
      process.env.PATH = `${runtime}:${process.env.PATH}`;
      expect(yield* installs.program('codex')).toEqual({ path: join(local, 'codex'), runtime: null });
      expect(runs(log)).toBe(2);
      script(join(local, 'devin'), counting(log, 'devin 3000.11.4'));
      yield* Effect.all([installs.program('devin'), installs.program('devin')], { concurrency: 2 });
      const reread = yield* Effect.all([installs.settled, installs.settled], { concurrency: 2 });
      expect(reread.map((rows) => rows.find((row) => row.harness === 'devin')?.version)).toEqual(['devin 3000.11.4', 'devin 3000.11.4']);
      expect(runs(log)).toBe(3);
    }),
);
