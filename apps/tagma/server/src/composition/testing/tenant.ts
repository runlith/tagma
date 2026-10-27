import { Effect } from 'effect';
import { span } from '@runlith/testbed/fixture';

export const tenant = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const stop = span('tenant');
    return Effect.ensuring(effect, Effect.sync(stop));
  });
