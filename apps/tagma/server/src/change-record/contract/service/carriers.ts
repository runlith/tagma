import { Context, type Effect } from 'effect';

export class CarrierAdmission extends Context.Service<
  CarrierAdmission,
  {
    admit(carriers: readonly string[]): Effect.Effect<() => void>;
  }
>()('tagma/change-record/CarrierAdmission') {}
