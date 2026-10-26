import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber } from 'effect';
import { AgentHostFailed } from '../../agent/AgentFailure';
import type { CallHooks } from '../../agent/AgentCalls';
import { composeCallHooks } from '../agents/ThreadAgent';
import { callRetention } from './assembly/outputs';
const closingInto = (order: string[]): Effect.Effect<void> =>
  Effect.sync(() => {
    order.push('closed');
  });
describe('the output scope a run holds', () => {
  it.effect(
    'a run ends at once with a call still writing, and the last release closes the scope',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const retention = callRetention(closingInto(order));
      const call = yield* retention.hooks.retain();
      yield* retention.runEnded;
      expect(order).toEqual([]);
      yield* Effect.yieldNow;
      expect(order).toEqual([]);
      yield* call.release;
      expect(order).toEqual(['closed']);
    }),
  );
  it.effect(
    'a run with nothing outstanding closes its scope as it ends',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const retention = callRetention(closingInto(order));
      const call = yield* retention.hooks.retain();
      yield* call.release;
      yield* retention.runEnded;
      expect(order).toEqual(['closed']);
    }),
  );
  it.effect(
    'a claim released is let go once, whatever asks twice, and closes the scope a single time',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const retention = callRetention(closingInto(order));
      const call = yield* retention.hooks.retain();
      yield* retention.runEnded;
      yield* call.release;
      yield* call.release;
      yield* retention.runEnded;
      expect(order).toEqual(['closed']);
    }),
  );
  it.effect(
    'one scope’s claims say nothing about another’s',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const first = callRetention(Effect.sync(() => order.push('first')));
      const second = callRetention(Effect.sync(() => order.push('second')));
      const held = yield* first.hooks.retain();
      yield* second.runEnded;
      expect(order).toEqual(['second']);
      yield* first.runEnded;
      expect(order).toEqual(['second']);
      yield* held.release;
      expect(order).toEqual(['second', 'first']);
    }),
  );
});
describe('the product’s hooks beside the run’s own', () => {
  const productOver = (order: string[]): CallHooks => ({
    retain: () =>
      Effect.sync(() => {
        order.push('product-retain');
        return { release: Effect.sync(() => order.push('product-release')) };
      }),
    completed: () => Effect.void,
  });
  it.effect(
    'a call takes both, and the product’s resources are let go before the run’s claim',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const retention = callRetention(closingInto(order));
      const hooks = composeCallHooks(retention.hooks, () => productOver(order))!;
      const call = yield* hooks({}).retain();
      expect(order).toEqual(['product-retain']);
      yield* call.release;
      expect(order).toEqual(['product-retain', 'product-release']);
      yield* retention.runEnded;
      expect(order).toEqual(['product-retain', 'product-release', 'closed']);
    }),
  );
  it.effect(
    'a product retention that failed leaves the run’s claim let go, so the scope can close',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const retention = callRetention(closingInto(order));
      const cause = new Error('no world stands here');
      const refusing: CallHooks = {
        retain: () => Effect.fail(new AgentHostFailed({ port: 'tools', cause })),
        completed: () => Effect.void,
      };
      const hooks = composeCallHooks(retention.hooks, () => refusing)!;
      expect(yield* Effect.flip(hooks({}).retain())).toMatchObject({ _tag: 'AgentHostFailed', port: 'tools', cause });
      yield* retention.runEnded;
      expect(order).toEqual(['closed']);
    }),
  );
  it.effect(
    'a claim let go before the run ended leaves the scope open until the run ends',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const retention = callRetention(closingInto(order));
      const call = yield* retention.hooks.retain();
      yield* call.release;
      expect(order).toEqual([]);
      const ending = yield* Effect.forkScoped(retention.runEnded);
      yield* Fiber.join(ending);
      expect(order).toEqual(['closed']);
    }),
  );
});
