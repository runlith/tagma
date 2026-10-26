import { Effect } from 'effect';
import type { Lifecycle } from './lifecycle';

export const helper = () => 1;

export { helper as aid };

export const fixture = () => {
  const make = (step: number) => step + 1;
  return { make, other: 2 };
};

export const made = () => {
  const { make } = fixture();
  return make(1);
};

export const stop: Lifecycle['Service']['stop'] = (reason) => Effect.log(reason);
