import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { BlockTreeUnreadable, unmergedRefusal } from '../tree/layout.js';

type Coerced<E> = E extends GateRefusal<infer Code> ? Code : E extends BlockTreeUnreadable ? 'graph-pool' | 'graph-unmerged' : 'graph-pool';

export const refusal = <E extends { readonly _tag: string; readonly message: string }>(error: E): GateRefusal<Coerced<E>> =>
  (error instanceof GateRefusal
    ? error
    : error instanceof BlockTreeUnreadable && error.reason === 'unmerged'
      ? unmergedRefusal(error.path)
      : error instanceof BlockTreeUnreadable
        ? new GateRefusal('graph-pool', `${error._tag} at ${error.path}: ${error.message}`, [
            `repair the graph file or layout at ${error.path}, then retry the operation`,
          ])
        : new GateRefusal('graph-pool', `${error._tag}: ${error.message}`, ['read the report and retry'])) as GateRefusal<Coerced<E>>;

export const refused = <A, E extends { readonly _tag: string; readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, GateRefusal<Coerced<E>>, R> => Effect.mapError(effect, (error: E) => refusal(error));
