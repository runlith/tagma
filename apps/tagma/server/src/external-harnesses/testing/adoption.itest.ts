import { afterAll, expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Fiber, FileSystem, Queue, Schema } from 'effect';
import { CurrentInvocation, Invocation } from '../../platform/cli/verb.js';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE, TERMINAL_VARIABLE } from '../../platform/contract/service/credentials.js';
import { shellDigest } from '../../platform/credentials/grants.js';
import { adoptionKeptName, harnessAdoptedSchema } from '../contract/wire/adoption.js';
import { adoptedHook } from '../hooks/adoption.js';
import { makeHookDelivery, type HookDoor } from '../hooks/delivery.js';
import { hookEventOf } from '../hooks/dispatch.js';
import { builtinRows } from './hookRows.js';

const home = mkdtempSync(join(tmpdir(), 'adopted-hook-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const unavailable = () => Effect.die('this hook called an unrelated door');

layer(BunFileSystem.layer, { excludeTestServices: true })('hook adoption', (it) => {
  it.effect('the adoption cache follows job proof, fresh starts, session ends and refusal retry policy', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const key = 'cli-session';
      const shell = 'operator-shell';
      const file = join(home, adoptionKeptName(key));
      const answer = { threadId: 'same-thread', grant: 'current-grant', session: 'new-session', job: { pid: 12, birth: 'native-birth' } };
      let answering = answer;
      let refusal: string | null = null;
      yield* files.writeFileString(
        file,
        JSON.stringify({ shell: shellDigest(shell), threadId: answer.threadId, grant: 'old-grant', session: 'ended-session' }),
      );
      const invoking = (event: Record<string, unknown>, grant?: string) =>
        new Invocation(
          { TMPDIR: home, [TERMINAL_VARIABLE]: shell, [GRANT_VARIABLE]: grant },
          home,
          () => new Blob([JSON.stringify(event)]).stream(),
          process.execPath,
        );
      const door: HookDoor = {
        orientation: { sessionStart: () => Effect.succeed(''), touch: unavailable },
        harness: {
          report: () => Effect.fail({ code: 'session-unknown', reason: 'this fixture only owns adoption' }),
          permission: unavailable,
          permissionOutcome: unavailable,
          guide: unavailable,
          adopt: () => (refusal === null ? Effect.succeed(answering) : Effect.fail({ code: refusal, reason: 'fixture refusal' })),
        },
        operations: { perform: unavailable },
        changes: { record: unavailable },
      };
      const connect = () => Effect.succeed(door);
      const event = { hook_event_name: 'PreToolUse', session_id: key, cwd: home };
      const at = invoking(event);
      yield* adoptedHook(at, makeHookDelivery({ connect }), event, builtinRows('claude-code')!, false).pipe(
        Effect.provideService(CurrentInvocation, at),
      );
      expect(at.env[GRANT_VARIABLE]).toBe(answer.grant);
      expect(at.env[SESSION_TOKEN_VARIABLE]).toBe(answer.session);
      const stored = yield* files.readFileString(file);
      expect(yield* Schema.decodeUnknownEffect(harnessAdoptedSchema)(JSON.parse(stored))).toEqual(answer);

      const next = invoking(event);
      yield* adoptedHook(next, makeHookDelivery({ connect: unavailable }), event, builtinRows('claude-code')!, false).pipe(
        Effect.provideService(CurrentInvocation, next),
      );
      expect(next.env[GRANT_VARIABLE]).toBe(answer.grant);
      expect(next.env[SESSION_TOKEN_VARIABLE]).toBe(answer.session);

      answering = { ...answer, grant: 'renewed-grant', session: 'renewed-session' };
      const startup = invoking({ ...event, hook_event_name: 'SessionStart' });
      yield* hookEventOf('session-start', startup, connect, builtinRows('claude-code')!).pipe(
        Effect.provideService(CurrentInvocation, startup),
      );
      expect(startup.env[GRANT_VARIABLE]).toBe(answering.grant);
      expect(startup.env[SESSION_TOKEN_VARIABLE]).toBe(answering.session);
      const ended = invoking({ ...event, hook_event_name: 'SessionEnd' }, answering.grant);
      yield* hookEventOf('observe', ended, connect, builtinRows('claude-code')!).pipe(Effect.provideService(CurrentInvocation, ended));
      expect(yield* files.exists(file)).toBe(false);

      refusal = 'shell-unknown';
      const rejected = invoking(event);
      yield* adoptedHook(rejected, makeHookDelivery({ connect }), event, builtinRows('claude-code')!, false).pipe(
        Effect.provideService(CurrentInvocation, rejected),
      );
      expect(JSON.parse(yield* files.readFileString(file))).toMatchObject({ refused: refusal, shell: shellDigest(shell) });
      refusal = null;
      const settled = invoking(event);
      yield* adoptedHook(settled, makeHookDelivery({ connect }), event, builtinRows('claude-code')!, false).pipe(
        Effect.provideService(CurrentInvocation, settled),
      );
      expect(settled.env[GRANT_VARIABLE]).toBeUndefined();

      refusal = 'job-unproven';
      const pending = { ...event, session_id: 'retry-session' };
      const unproven = invoking(pending);
      yield* adoptedHook(unproven, makeHookDelivery({ connect }), pending, builtinRows('claude-code')!, false).pipe(
        Effect.provideService(CurrentInvocation, unproven),
      );
      expect(yield* files.exists(join(home, adoptionKeptName(pending.session_id)))).toBe(false);
      refusal = null;
      const retried = invoking(pending);
      yield* adoptedHook(retried, makeHookDelivery({ connect }), pending, builtinRows('claude-code')!, false).pipe(
        Effect.provideService(CurrentInvocation, retried),
      );
      expect(retried.env[GRANT_VARIABLE]).toBe(answering.grant);
      expect(retried.env[SESSION_TOKEN_VARIABLE]).toBe(answering.session);
    }),
  );

  it.effect('interrupting adoption kills and reaps its ancestry process before returning', () =>
    Effect.gen(function* () {
      writeFileSync(join(home, 'ps'), '#!/bin/sh\nexec /bin/sleep 5\n', { mode: 0o755 });
      const started = yield* Effect.acquireRelease(Queue.unbounded<number>(), Queue.shutdown);
      const children: ReturnType<typeof Bun.spawn>[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = { spawn: Bun.spawn, path: process.env.PATH };
          process.env.PATH = home;
          const observed: typeof Bun.spawn = (...args: readonly unknown[]) => {
            const child = Reflect.apply(previous.spawn, Bun, args);
            if (Array.isArray(args[0]) && args[0][0] === 'ps') {
              children.push(child);
              Queue.offerUnsafe(started, child.pid);
            }
            return child;
          };
          Bun.spawn = observed;
          return previous;
        }),
        (previous) =>
          Effect.promise(async () => {
            Bun.spawn = previous.spawn;
            process.env.PATH = previous.path;
            for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
            await Promise.all(children.map((child) => child.exited));
          }),
      );
      const at = new Invocation(
        { TMPDIR: home, [TERMINAL_VARIABLE]: 'operator-shell' },
        home,
        () => new ReadableStream(),
        process.execPath,
      );
      const checking = yield* Effect.forkScoped(
        adoptedHook(at, makeHookDelivery({ connect: unavailable }), { session_id: 'interrupted' }, builtinRows('claude-code')!, false),
      );
      const pid = yield* Queue.take(started);
      yield* Fiber.interrupt(checking);
      const standing = yield* Effect.result(Effect.try({ try: () => process.kill(pid, 0), catch: (cause) => cause }));
      expect(standing).toMatchObject({ _tag: 'Failure', failure: { code: 'ESRCH' } });
    }),
  );
});
