import { Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { SessionRead } from '../../threads/contract/service/harness.js';
import { readExternalSession } from '../session.js';

export const sessionReadLayer = Layer.effect(
  SessionRead,
  Effect.gen(function* () {
    const { db } = yield* MachineStore;
    const units = yield* MachineUnits;
    return (threadId, unit) =>
      unit === undefined ? units.read((unit) => readExternalSession(db, unit, threadId)) : readExternalSession(db, unit, threadId);
  }),
);
