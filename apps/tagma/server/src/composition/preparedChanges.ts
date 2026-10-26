import { Context, Effect, Layer } from 'effect';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { CarrierAdmission } from '../change-record/contract/service/carriers.js';
import type { CommandChanges } from '../change-record/contract/service/commands.js';
import type { SharedPrepared } from '../change-record/contract/service/prepared.js';
import type { CommitShape } from '../change-record/contract/service/shape.js';
import { preparedChangesOver } from '../change-record/serving.js';
import type { Holdings } from '../change-record/contract/service/holdings.js';
import type { Walks } from '../change-record/lines/walks.js';
import { CHECKOUT_DIRECTORY } from '../graph/contract/wire/storage.js';

export const landingAdmission = (admission: Context.Service.Shape<typeof RunAdmission>): CarrierAdmission['Service'] => ({
  admit: (carriers) => Effect.sync(() => admission.hold(carriers)),
});

export const landingAdmissionLayer: Layer.Layer<CarrierAdmission, never, RunAdmission> = Layer.effect(
  CarrierAdmission,
  Effect.gen(function* () {
    return landingAdmission(yield* RunAdmission);
  }),
);

export const sharedPrepared = (
  instanceDir: string,
  admission: Context.Service.Shape<typeof RunAdmission>,
  commands: CommandChanges['Service'],
  holdings: Holdings['Service'],
  walks: Walks,
  shape: CommitShape['Service'],
): SharedPrepared => {
  const carriers = landingAdmission(admission);
  return {
    admission: carriers,
    changes: preparedChangesOver(carriers, commands, instanceDir, CHECKOUT_DIRECTORY, holdings, walks, shape),
  };
};
