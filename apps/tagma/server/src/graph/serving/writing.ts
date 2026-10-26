import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { CopyWriting } from '../contract/service/serving.js';

export const writableAt = (copy: CopyWriting | null): Effect.Effect<void, GateRefusal<'detached-checkout'>> => {
  const at = copy?.readOnly;
  return at === undefined
    ? Effect.void
    : Effect.fail(
        new GateRefusal(
          'detached-checkout',
          `${at.checkout} stands on detached HEAD; its graph is readable but cannot be written from that checkout`,
          [`switch ${at.checkout} to a branch, then write its graph`, `aim at the main checkout ${at.main} instead`],
        ),
      );
};
