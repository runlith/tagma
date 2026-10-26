import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Schema } from 'effect';
import { Tool } from '../tool';
import { call, countingTool, open } from './testing/open';
import { ASKS_NEVER } from '../../permissions/vocabulary';
describe('CallLedger', () => {
  it.effect(
    'one call id settles once, including while its first caller is still waiting',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const { door } = open();
      const settling = call(
        Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Stay in flight until released.',
          parameters: Schema.Struct({}),
          execute: Effect.fnUntraced(function* () {
            runs += 1;
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
            return { ok: true };
          }),
        }),
      );
      const first = yield* Effect.forkScoped(door.settle(settling));
      yield* Deferred.await(entered);
      const second = yield* Effect.forkScoped(door.settle(settling), { startImmediately: true });
      yield* Deferred.succeed(release, undefined);
      const settled = yield* Fiber.join(first);
      const replayed = yield* Fiber.join(second);
      const projected = yield* door.settled({ ...settling, output: { ok: true }, toolCallId: 'call-1' });
      expect(runs).toBe(1);
      expect(replayed).toEqual(settled);
      expect(projected).toEqual(settled);
      expect(settled.executed).toBe(true);
    }),
  );
  it.effect(
    'a projection read of an unsettled id leaves the id free for the call itself',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const { door } = open();
      const settling = call(
        countingTool(() => {
          runs += 1;
        }),
        { toolCallId: 'call-projected-first' },
      );
      const projected = yield* door.settled({ ...settling, output: { ok: 'from the provider' }, toolCallId: 'call-projected-first' });
      const settled = yield* door.settle(settling);
      expect(projected.output).toEqual({ ok: 'from the provider' });
      expect(runs).toBe(1);
      expect(settled.output).toEqual({ ok: true });
    }),
  );
  it.effect(
    'a spent id replays across generations, refuses another name, and leaves a new id free',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const { door } = open();
      const tool = countingTool(() => {
        runs += 1;
      });
      const first = yield* door.settle(call(tool, { toolCallId: 'call-7' }));
      expect(first.executed).toBe(true);
      expect(runs).toBe(1);
      expect(yield* door.settle(call(tool, { toolCallId: 'call-7' }))).toEqual(first);
      expect(runs).toBe(1);
      expect(yield* Effect.flip(door.settle(call(tool, { toolCallId: 'call-7', name: 'other_tool' })))).toMatchObject({
        _tag: 'AgentToolCallReused',
        toolCallId: 'call-7',
        settledAs: 'side_effect',
        attempted: 'other_tool',
      });
      door.admit({ generation: 1, ctx: {} });
      expect(yield* door.settle(call(tool, { toolCallId: 'call-7' }))).toEqual(first);
      expect(runs).toBe(1);
      expect(yield* Effect.flip(door.settle(call(tool, { toolCallId: 'call-7', name: 'other_write' })))).toMatchObject({
        _tag: 'AgentToolCallReused',
        toolCallId: 'call-7',
        settledAs: 'side_effect',
        attempted: 'other_write',
      });
      expect(runs).toBe(1);
      expect((yield* door.settle(call(tool, { toolCallId: 'call-8' }))).executed).toBe(true);
      expect(runs).toBe(2);
    }),
  );
});
