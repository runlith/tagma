import { expect } from 'bun:test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { layer } from '@runlith/effect-test';
import { Clock, Console, Deferred, Effect, Fiber, Layer } from 'effect';
import { Console as NodeConsole } from 'node:console';
import { Writable } from 'node:stream';
import { TestClock } from 'effect/testing';
import { CurrentInvocation, Invocation } from '../../platform/cli/verb.js';
import { PERMISSION_TIMEOUT_SECONDS, RUN_UNOWNED, type HarnessAnswer } from '../contract/wire/call.js';
import { makeHookDelivery, type HookDoor } from '../hooks/delivery.js';
import { hookEventOf } from '../hooks/dispatch.js';
import { builtinRows } from './hookRows.js';
import { declaredHarness } from '../adapter/declared.js';
import { grok } from '@runlith/adapter-xai/harness';
import { GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import type { HarnessReceipt, HarnessReportInput } from '../../threads/contract/wire/harness/observation.js';

const unused = () => Effect.die('this delivery called an unrelated door');
const deaf: HookDoor = {
  orientation: { sessionStart: unused, touch: unused },
  harness: { report: unused, permission: unused, permissionOutcome: unused, guide: unused, adopt: unused },
  operations: { perform: () => Effect.never },
  changes: { record: unused },
};
const connect = () => Effect.succeed(deaf);
const at = new Invocation({}, '/project', () => new ReadableStream(), 'hook');
const SLOW_MS = 30_000;

const permissionHook = (permissionOutcome: () => Effect.Effect<HarnessAnswer, unknown>) => {
  const output: string[] = [];
  const reports: HarnessReportInput[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      output.push(String(chunk));
      done();
    },
  });
  const console = new NodeConsole({ stdout, stderr: stdout });
  const invocation = new Invocation(
    { [GRANT_VARIABLE]: 'fixture-grant' },
    '/project',
    () => new Blob([JSON.stringify({ source: 'fixture', tool_name: 'Bash', tool_input: { command: 'pwd' } })]).stream(),
    'hook',
  );
  const door: HookDoor = {
    ...deaf,
    harness: {
      ...deaf.harness,
      report: ({ payload }) =>
        Effect.suspend(() => {
          reports.push(payload);
          return Effect.fail({ code: 'session-unknown', reason: 'this fixture only judges permission' });
        }),
      permission: () => Effect.succeed({ _tag: 'Asked', requestId: 'question' }),
      permissionOutcome,
    },
  };
  const answer = hookEventOf('permission-request', invocation, () => Effect.succeed(door), builtinRows('claude-code')!).pipe(
    Effect.provideService(CurrentInvocation, invocation),
    Effect.provideService(Console.Console, console),
  );
  return { answer, output, reports };
};

layer(Layer.merge(MemoryFileSystem.layer, Layer.succeed(CurrentInvocation, at)))('hook delivery', (it) => {
  it.effect('every call of one hook waits for the server’s own answer, however slow it is', () =>
    Effect.gen(function* () {
      const delivery = makeHookDelivery({ connect });
      const slow = (answer: string) => () => Effect.as(Effect.sleep(SLOW_MS), answer);
      const first = yield* Effect.forkScoped(delivery.send(slow('reported')));
      yield* TestClock.adjust(SLOW_MS);
      expect(yield* Fiber.join(first)).toEqual({ _tag: 'Answered', value: 'reported' });
      const second = yield* Effect.forkScoped(delivery.answered(slow('guided')));
      yield* TestClock.adjust(SLOW_MS);
      expect(yield* Fiber.join(second)).toBe('guided');
    }),
  );

  it.effect('an idempotent call lost on the wire is repeated until answered, while a refusal is terminal', () =>
    Effect.gen(function* () {
      const delivery = makeHookDelivery({ connect });
      const lost = [Effect.fail(new Error('connection reset')), Effect.fail(new Error('connection reset')), Effect.succeed('told')];
      expect(yield* delivery.idempotent(() => lost.shift() ?? unused())).toBe('told');
      const refused = [Effect.fail({ code: 'not-found', reason: 'no such thread' }), Effect.succeed('must not be applied')];
      expect(yield* delivery.idempotent(() => refused.shift() ?? unused())).toBeUndefined();
    }),
  );

  it.effect('an idempotent exchange stops after its bounded attempts rather than renewing the retry budget', () =>
    Effect.gen(function* () {
      const delivery = makeHookDelivery({ connect });
      const attempts = [
        Effect.fail(new Error('connection reset')),
        Effect.fail(new Error('connection reset')),
        Effect.fail(new Error('connection reset')),
        Effect.succeed('must not be applied'),
      ];
      expect(yield* delivery.idempotent(() => attempts.shift() ?? unused())).toBeUndefined();
    }),
  );

  it.effect('a temporarily unowned run is retried after the ownership delay', () =>
    Effect.gen(function* () {
      const delivery = makeHookDelivery({ connect });
      const attempts = [Effect.fail({ code: RUN_UNOWNED, reason: 'awaiting admission' }), Effect.succeed('joined')];
      const delivered = yield* Effect.forkScoped(delivery.send(() => attempts.shift() ?? unused()));
      yield* TestClock.adjust(249);
      expect((yield* Fiber.join(delivered).pipe(Effect.timeoutOption(0)))._tag).toBe('None');
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(delivered)).toEqual({ _tag: 'Answered', value: 'joined' });
    }),
  );
  it.effect('a permission hook stops at its overall deadline when every outcome exchange remains unanswered', () =>
    Effect.gen(function* () {
      const waiting = yield* Deferred.make<void>();
      const hook = permissionHook(() => Effect.andThen(Deferred.succeed(waiting, undefined), Effect.never));
      const answering = yield* Effect.forkScoped(hook.answer);
      yield* Deferred.await(waiting);
      yield* TestClock.adjust((PERMISSION_TIMEOUT_SECONDS - 1) * 1000 - 1);
      expect((yield* Fiber.join(answering).pipe(Effect.timeoutOption(0)))._tag).toBe('None');
      yield* TestClock.adjust(1);
      expect((yield* Fiber.join(answering).pipe(Effect.timeoutOption(0)))._tag).toBe('Some');
      expect(hook.output).toEqual([]);
    }),
  );

  it.effect('a permission hook recovers after an unreachable outcome and emits the settled answer with one captured report', () =>
    Effect.gen(function* () {
      const waiting = yield* Deferred.make<void>();
      const capturedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      const outcomes: Effect.Effect<HarnessAnswer, unknown>[] = [
        Effect.fail(new Error('connection reset')),
        Effect.succeed({ _tag: 'Waiting' }),
        Effect.succeed({ _tag: 'Allowed', ruleId: 'project-read', reason: null }),
      ];
      const hook = permissionHook(() => Effect.andThen(Deferred.succeed(waiting, undefined), outcomes.shift() ?? unused()));
      const answering = yield* Effect.forkScoped(hook.answer);
      yield* Deferred.await(waiting);
      yield* TestClock.adjust(999);
      expect((yield* Fiber.join(answering).pipe(Effect.timeoutOption(0)))._tag).toBe('None');
      yield* TestClock.adjust(1);
      yield* Fiber.join(answering);
      expect(JSON.parse(hook.output.join('')).decision).toBe('approve');
      expect(hook.reports).toEqual([
        expect.objectContaining({ occasion: 'self-description', capturedAt, event: expect.objectContaining({ source: 'fixture' }) }),
      ]);
    }),
  );

  it.effect('OpenCode stop delivery carries the interrupted or failed outcome and the upstream failure', () =>
    Effect.gen(function* () {
      const reports: HarnessReportInput[] = [];
      const door: HookDoor = {
        ...deaf,
        harness: {
          ...deaf.harness,
          report: ({ payload }) =>
            Effect.sync(() => {
              reports.push(payload);
              return { outcome: 'admitted', revision: 1, cause: null, harness: 'opencode', transport: 'terminal' } satisfies HarnessReceipt;
            }),
        },
      };
      for (const outcome of [{ status: 'aborted' }, { status: 'error', error: 'provider rejected the request' }]) {
        const invocation = new Invocation(
          { [GRANT_VARIABLE]: 'fixture-grant' },
          '/project',
          () => new Blob([JSON.stringify({ hook_event_name: 'Stop', session_id: 'ses_terminal', ...outcome })]).stream(),
          'hook',
        );
        yield* hookEventOf('stop', invocation, () => Effect.succeed(door), builtinRows('opencode')!).pipe(
          Effect.provideService(CurrentInvocation, invocation),
        );
        expect(reports.at(-1)?.event).toMatchObject(outcome);
      }
    }),
  );

  it.effect('a hook registered for one CLI and run by another that publishes the event’s session reports nothing', () =>
    Effect.gen(function* () {
      const reports: HarnessReportInput[] = [];
      const door: HookDoor = {
        ...deaf,
        harness: {
          ...deaf.harness,
          report: ({ payload }) =>
            Effect.sync(() => {
              reports.push(payload);
              return { outcome: 'admitted', revision: 1, cause: null, harness: 'grok', transport: 'terminal' } satisfies HarnessReceipt;
            }),
        },
      };
      const event = JSON.stringify({ hook_event_name: 'Stop', session_id: 'grok-session', last_assistant_message: 'done' });
      const ranBy = (named: 'claude-code' | 'grok') => {
        const invocation = new Invocation(
          { [GRANT_VARIABLE]: 'fixture-grant', GROK_SESSION_ID: 'grok-session' },
          '/project',
          () => new Blob([event]).stream(),
          'hook',
        );
        const row = named === 'grok' ? declaredHarness(grok)! : builtinRows(named)!.named!;
        const signers = [{ harness: grok.id, variable: grok.terminal?.variable }];
        return hookEventOf('stop', invocation, () => Effect.succeed(door), { named: row, rows: [row], signers }).pipe(
          Effect.provideService(CurrentInvocation, invocation),
        );
      };
      yield* ranBy('claude-code');
      expect(reports).toEqual([]);
      yield* ranBy('grok');
      expect(reports.length).toBeGreaterThan(0);
    }),
  );
});
