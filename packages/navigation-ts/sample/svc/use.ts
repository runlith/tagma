import { Effect } from 'effect';
import { aid } from './fixture';
import { Lifecycle as Life } from './lifecycle';

export const run = Effect.gen(function* () {
  const lifecycle = yield* Life;
  yield* lifecycle.stop('done');
  const { stop } = lifecycle;
  yield* stop('again');
  const { stop: halt } = lifecycle;
  yield* halt('third');
  return aid();
});

const unrelated = { stop: 1, go: 2 };
export const value = unrelated.stop;
export const label = 'stop';
