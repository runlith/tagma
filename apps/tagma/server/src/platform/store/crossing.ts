import { Data, Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { StoreBrand, StoreFailure } from '../contract/service/store.js';
import type { Units, WriteUnit } from '../contract/service/units.js';
import type { WriteSet } from '../contract/service/writes.js';

export type StoredFailure = StoreFailure | ThreadStorageFailed;

export const stored =
  (call: string) =>
  <A>(query: Effect.Effect<A, StoredFailure>): Effect.Effect<A, ThreadStorageFailed> =>
    Effect.mapError(query, (cause) => (cause instanceof ThreadStorageFailed ? cause : new ThreadStorageFailed({ call, cause })));

export const trusted = <A>(call: string, read: () => A): Effect.Effect<A, ThreadStorageFailed> =>
  Effect.try({ try: read, catch: (cause) => new ThreadStorageFailed({ call, cause }) });

class Carried<E> extends Data.TaggedError('ThreadUnitCarried')<{ readonly failure: E }> {}

export function inUnit<T, E, Brand extends StoreBrand>(
  units: Units<Brand>,
  set: WriteSet,
  call: string,
  work: (unit: WriteUnit<Brand>) => Effect.Effect<T, E>,
): Effect.Effect<T, E | ThreadStorageFailed> {
  return units
    .write(set, (unit) => Effect.mapError(work(unit), (failure) => new Carried({ failure })))
    .pipe(Effect.mapError((cause) => (cause instanceof Carried ? (cause.failure as E) : new ThreadStorageFailed({ call, cause }))));
}
