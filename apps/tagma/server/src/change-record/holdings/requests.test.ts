import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Scheduler } from 'effect';
import type { Judged } from '../contract/service/holdings.js';
import { Requests } from './requests.js';

const judged: Judged = {
  print: 'fresh',
  head: null,
  digests: null,
  holding: {
    path: 'same',
    from: null,
    git: null,
    lines: 'unweighed',
    verdict: { verdict: 'unknown', reason: { kind: 'budget' }, writers: [] },
  },
  verdict: { verdict: 'unknown', reason: 'budget', writers: [] },
};

it.live('failure settles old requests while a woken caller can request the same path again', () =>
  Effect.gen(function* () {
    const requests = new Requests();
    const old = requests.admit(['same', 'same']);
    const arrival = yield* Effect.forkChild(Effect.map(Deferred.await(old[0]![1]), () => requests.admit(['same'])));
    yield* Effect.yieldNow;
    yield* requests.fail();
    const fresh = yield* Fiber.join(arrival);
    requests.begin(['same']);
    yield* requests.answer('same', judged);
    const result = yield* requests.wait(fresh);
    expect(result.get('same')).toBe(judged);
    expect((yield* requests.wait(old)).size).toBe(0);
  }).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 8)),
);
