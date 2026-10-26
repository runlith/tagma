import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Schema, Stream } from 'effect';
import { settingKey } from '../platform/contract/wire/setting.js';
import { liveOf } from './live.js';
import type { SettingLayer } from './resolution.js';

const key = settingKey({
  id: 'test.share',
  order: 1,
  title: 'Share',
  description: 'Share',
  schema: Schema.Number,
  fallback: 1,
  scopes: ['user'],
  merge: 'replace',
});

it.effect('a change stream keeps its acquired value and delivers the next write', () =>
  Effect.gen(function* () {
    const live = liveOf(() => Effect.succeed([]));
    const changes = yield* live.changes(key);
    live.publish(key.id, 'user', null, '0.5', false);
    expect(yield* Stream.runCollect(Stream.take(changes, 2))).toEqual([1, 0.5]);
  }),
);

it.effect('a slow setting reader receives the latest write', () =>
  Effect.gen(function* () {
    const live = liveOf(() => Effect.succeed([]));
    const changes = yield* live.changes(key);
    const pull = yield* Stream.toPull(changes);
    expect(yield* pull).toEqual([1]);
    live.publish(key.id, 'user', null, '0.5', false);
    live.publish(key.id, 'user', null, '0.25', false);
    expect(yield* pull).toEqual([0.25]);
  }),
);

it.effect('a write while the initial read is suspended becomes the current value', () =>
  Effect.gen(function* () {
    const reading = yield* Deferred.make<void>();
    const ready = yield* Deferred.make<SettingLayer[]>();
    const live = liveOf(() => Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(ready)));
    const acquiring = yield* Effect.forkScoped(live.changes(key));
    yield* Deferred.await(reading);
    live.publish(key.id, 'user', null, '0.5', false);
    yield* Deferred.succeed(ready, []);
    const changes = yield* Fiber.join(acquiring);
    expect(yield* Stream.runCollect(Stream.take(changes, 1))).toEqual([0.5]);
    live.publish(key.id, 'user', null, '0.25', false);
    expect(yield* Stream.runCollect(Stream.take(changes, 1))).toEqual([0.25]);
  }),
);
