import { Effect } from 'effect';
import { threadBorderOut } from '../ThreadBorder';

export function threadPromise<A, E>(work: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(threadBorderOut(work));
}
