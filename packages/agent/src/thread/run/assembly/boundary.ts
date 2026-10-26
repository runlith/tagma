import { Effect } from 'effect';
import type { ThreadSupplyPlan } from '../../agents/supply';
import type { ThreadContextBoundary, ThreadContextPreparation } from '../../agents/ThreadAgent';
import type { ThreadContextEvidence } from '../../rows';
import { ThreadCallBroke } from '../../ThreadBorder';
import { type ThreadContextStanding, ThreadRunContexts } from '../ThreadRunContexts';
import type { ThreadRunRef } from '../ThreadRunLedger';

export const makeRunBoundary = Effect.gen(function* () {
  const contexts = yield* ThreadRunContexts;

  return (ref: ThreadRunRef, supply: ThreadSupplyPlan, halted: () => boolean): ThreadContextBoundary => {
    let opened = false;

    const preparation = (
      change: ThreadContextStanding,
      publish: ThreadContextPreparation['publish'],
      deny: ThreadContextPreparation['deny'],
      restored?: ThreadContextEvidence,
    ): ThreadContextPreparation => ({
      context: change.context,
      supply: restored === undefined ? supply : { ...supply, restored: restored.tools },
      instructions: restored ? restored.instructions : undefined,
      publish,
      deny,
    });

    return Effect.fnUntraced(function* ({ generation }) {
      if (!opened) {
        opened = true;
        const stood = yield* contexts.read(ref);
        if (stood.standing !== null && !stood.standing.held) {
          yield* contexts.deny(stood.standing, new Error('The process that asked for this context change left before it was published.'));
        }
        if (generation === 0 && stood.admitted !== null) {
          const { record, evidence } = stood.admitted;
          return preparation(
            {
              threadId: ref.threadId,
              runId: ref.id,
              requestId: record.requestId,
              sourceKey: record.sourceKey,
              fromGeneration: 0,
              context: record,
              held: true,
            },
            () => Effect.succeed(true),
            (cause) => Effect.fail(new ThreadCallBroke({ cause })),
            evidence,
          );
        }
      }
      if (!contexts.holds(ref.id)) return null;
      const standing = (yield* contexts.read(ref)).standing;
      if (!standing || !standing.held) return null;
      if (halted()) return null;
      return preparation(
        standing,
        (admitted) => contexts.publish(standing, { ...admitted, halted }),
        (cause) => contexts.deny(standing, cause),
      );
    });
  };
});
