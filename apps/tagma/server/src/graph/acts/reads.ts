import { type Context, Effect } from 'effect';
import type { StoreBrand } from '../../platform/contract/service/store.js';
import type { Units } from '../../platform/contract/service/units.js';

type Marker = Pick<Units<StoreBrand>, 'markReadOnly'>;

export const readsOf =
  (units: Marker) =>
  <F extends (...args: never[]) => Effect.Effect<unknown, unknown, unknown>>(verb: F): F =>
    ((...args: never[]) => units.markReadOnly(verb(...args))) as F;

export const readsThrough =
  <I, S extends Marker>(tag: Context.Key<I, S>) =>
  <Args extends readonly unknown[], A, E, R>(
    verb: (...args: Args) => Effect.Effect<A, E, R>,
  ): ((...args: Args) => Effect.Effect<A, E, R | I>) =>
  (...args) =>
    Effect.flatMap(tag, (units) => units.markReadOnly(verb(...args)));
