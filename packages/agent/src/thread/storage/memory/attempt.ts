import { Effect } from 'effect';
import { isPortRefusal, type ThreadPortFailure } from '../../ThreadBorder';
import { ThreadStorageFailed } from '../../persisted';

export function attempt<T>(call: string, work: () => T): Effect.Effect<T, ThreadPortFailure> {
  return Effect.try({
    try: work,
    catch: (cause) => (isPortRefusal(cause) ? cause : new ThreadStorageFailed({ call, cause })),
  });
}
