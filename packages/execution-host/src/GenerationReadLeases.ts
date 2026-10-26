import { Deferred, Duration, Effect } from 'effect';
import { type ExecutionRef, type Incarnation } from '@runlith/executions/protocol/execution';
import { ExecutionUnknown } from './executionFailures';
import { declare, type Held } from '@runlith/held/Held';
import { type HoldCut, type HoldStalled } from '@runlith/held/failures';

export type GenerationReadLeases = {
  readonly admitRetainedRead: (ref: ExecutionRef) => Effect.Effect<void, ExecutionUnknown | HoldStalled | HoldCut>;
  readonly releaseRetainedRead: (incarnation: Incarnation) => Effect.Effect<void>;
  readonly fenceRetainedReads: (
    incarnation: Incarnation,
  ) => Effect.Effect<{ readonly readers: number; readonly drained: Deferred.Deferred<void> | undefined }, HoldStalled | HoldCut>;
  readonly dropGenerationReads: (incarnation: Incarnation) => void;
};

export const makeGenerationReadLeases = (): GenerationReadLeases => {
  const reads: Held<Incarnation> = declare<Incarnation>({
    name: 'retired-generation-read',
    owner: 'execution-host',
    rank: 100,
    key: (incarnation) => String(incarnation),
    concurrency: 1,
    threshold: Duration.seconds(10),
    ceilings: {
      hold: Duration.seconds(10),
      wait: Duration.seconds(10),
      leaves: 'the read was not admitted and took no bytes',
    },
    external: 'none',
  });

  type GenerationReaderCounts = {
    readers: number;
    fenced: boolean;
    drained: Deferred.Deferred<void> | undefined;
  };

  const counts = new Map<Incarnation, GenerationReaderCounts>();

  const admitRetainedRead = (ref: ExecutionRef): Effect.Effect<void, ExecutionUnknown | HoldStalled | HoldCut> =>
    reads.hold(
      ref.incarnation,
      Effect.suspend(() => {
        const found = counts.get(ref.incarnation);
        if (found !== undefined && found.fenced) return Effect.fail(new ExecutionUnknown({ execution: ref.execution }));
        const readers = (found?.readers ?? 0) + 1;
        counts.set(ref.incarnation, { readers, fenced: found?.fenced ?? false, drained: found?.drained });
        return Effect.void;
      }),
    );

  const releaseRetainedRead = (incarnation: Incarnation): Effect.Effect<void> =>
    Effect.suspend(() => {
      const found = counts.get(incarnation);
      if (found === undefined) return Effect.void;
      const readers = Math.max(0, found.readers - 1);
      counts.set(incarnation, { readers, fenced: found.fenced, drained: found.drained });
      return readers === 0 && found.fenced && found.drained !== undefined
        ? Effect.asVoid(Deferred.succeed(found.drained, undefined))
        : Effect.void;
    });

  const fenceRetainedReads = (incarnation: Incarnation) =>
    reads.hold(
      incarnation,
      Effect.sync(() => {
        const found = counts.get(incarnation);
        const readers = found?.readers ?? 0;
        const drained = readers > 0 ? Deferred.makeUnsafe<void>() : undefined;
        counts.set(incarnation, { readers, fenced: true, drained });
        return { readers, drained };
      }),
    );

  const dropGenerationReads = (incarnation: Incarnation): void => {
    counts.delete(incarnation);
  };

  return { admitRetainedRead, releaseRetainedRead, fenceRetainedReads, dropGenerationReads };
};
