import { Effect } from 'effect';
import { uuidv7 } from 'uuidv7';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import {
  EnvironmentUseId,
  type EnvironmentBinding,
  type EnvironmentConsumer,
  type EnvironmentVerdictFailure,
  type EnvironmentUse,
  type EnvironmentUseEvidence,
} from '../contract/wire/environments.js';
import type { EnvironmentUseStore, EnvironmentUseStoreFailure } from '../store/environmentUses.js';
import { environmentVerdictOf } from './failure.js';

type UseFailure = EnvironmentVerdictFailure | EnvironmentUseStoreFailure;

export type EnvironmentUses = ReturnType<typeof makeEnvironmentUses>;

export const makeEnvironmentUses = ({ uses }: { readonly uses: EnvironmentUseStore }) => {
  const reserve = Effect.fn('EnvironmentUses.reserve')(
    function* (
      unit: WriteUnit<'machine'>,
      binding: EnvironmentBinding,
      consumer: EnvironmentConsumer,
    ): Effect.fn.Return<EnvironmentUse, UseFailure> {
      const use: EnvironmentUse = {
        useId: EnvironmentUseId.make(uuidv7()),
        consumer,
        binding,
        outcome: 'reserved',
      };
      yield* uses.insert(use, unit);
      return use;
    },
    (work) => Effect.mapError(work, environmentVerdictOf),
  );

  const activate = Effect.fn('EnvironmentUses.activate')(
    function* (unit: WriteUnit<'machine'>, useId: EnvironmentUseId): Effect.fn.Return<EnvironmentUse, UseFailure> {
      const use = yield* read(useId, unit);
      if (use.outcome === 'active') return use;
      if (use.outcome !== 'reserved') {
        return yield* Effect.fail<EnvironmentVerdictFailure>({
          _tag: 'EnvironmentUseResolved',
          useId,
          outcome: use.outcome,
        });
      }
      yield* uses.outcome(useId, 'active', unit);
      return { ...use, outcome: 'active' };
    },
    (work) => Effect.mapError(work, environmentVerdictOf),
  );

  const release = Effect.fn('EnvironmentUses.release')(
    function* (
      unit: WriteUnit<'machine'>,
      useId: EnvironmentUseId,
      consumer: EnvironmentConsumer,
      evidence: EnvironmentUseEvidence,
    ): Effect.fn.Return<EnvironmentUse, UseFailure> {
      const use = yield* read(useId, unit);
      if (use.consumer.kind !== consumer.kind || use.consumer.id !== consumer.id) {
        return yield* Effect.fail<EnvironmentVerdictFailure>({ _tag: 'EnvironmentUseMissing', useId });
      }
      if (use.outcome === 'released') return use;
      const outcome = evidence === 'uncertain' ? 'release-pending' : 'released';
      if (use.outcome === outcome) return use;
      yield* uses.outcome(useId, outcome, unit);
      return { ...use, outcome };
    },
    (work) => Effect.mapError(work, environmentVerdictOf),
  );

  const admitRemoval = Effect.fn('EnvironmentUses.admitRemoval')(
    function* (unit: WriteUnit<'machine'>, binding: EnvironmentBinding): Effect.fn.Return<void, UseFailure> {
      const standing = yield* uses.standing(binding.environmentId, unit);
      if (standing.uses === 0) return;
      return yield* Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'EnvironmentUseConflict',
        binding,
        held: standing.consumers,
        holders: standing.holders,
        standing: standing.uses,
      });
    },
    (work) => Effect.mapError(work, environmentVerdictOf),
  );

  const heldBy = Effect.fn('EnvironmentUses.heldBy')(
    (unit: Unit<'machine'>, consumer: EnvironmentConsumer) => uses.heldBy(consumer, unit),
    (work) => Effect.mapError(work, environmentVerdictOf),
  );

  const read = Effect.fn('EnvironmentUses.read')(function* (
    useId: EnvironmentUseId,
    unit: Unit<'machine'>,
  ): Effect.fn.Return<EnvironmentUse, UseFailure> {
    const use = yield* uses.byId(useId, unit);
    if (use === null) return yield* Effect.fail<EnvironmentVerdictFailure>({ _tag: 'EnvironmentUseMissing', useId });
    return use;
  });

  return { reserve, activate, release, admitRemoval, heldBy };
};
