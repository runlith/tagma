import { Cause, Effect } from 'effect';
import { errorChain } from '@runlith/utils/error';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { BlockTreeUnreadable, unmergedRefusal } from '../tree/layout.js';

type Coerced<E> = E extends GateRefusal<infer Code> ? Code : E extends BlockTreeUnreadable ? 'graph-pool' | 'graph-unmerged' : 'graph-pool';

const detail = (error: { readonly _tag: string; readonly message: string }): string => {
  const chain = error instanceof Error ? errorChain(error) : [];
  const cause = error instanceof Error ? error.cause : undefined;
  const rest = Cause.isCause(cause)
    ? cause.reasons.flatMap((reason) =>
        errorChain(Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : reason),
      )
    : chain.slice(1);
  return [`${error._tag}: ${chain[0]?.message ?? error.message}`, ...rest.map(({ tag, message }) => `${tag}: ${message}`)].join(
    '; caused by ',
  );
};

export const refusal = <E extends { readonly _tag: string; readonly message: string }>(error: E): GateRefusal<Coerced<E>> =>
  (error instanceof GateRefusal
    ? error
    : error instanceof BlockTreeUnreadable && error.reason === 'unmerged'
      ? unmergedRefusal(error.path)
      : error instanceof BlockTreeUnreadable
        ? new GateRefusal('graph-pool', `${error._tag} at ${error.path}: ${error.message}`, [
            `repair the graph file or layout at ${error.path}, then retry the operation`,
          ])
        : new GateRefusal('graph-pool', detail(error), ['read the report and retry'])) as GateRefusal<Coerced<E>>;

export const refused = <A, E extends { readonly _tag: string; readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, GateRefusal<Coerced<E>>, R> => Effect.mapError(effect, (error: E) => refusal(error));
