import { Effect } from 'effect';
import { said } from '../../platform/contract/service/presentation.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import { vacuumRefusal } from '../contract/wire/status.js';
import { vacuumDisplay, vacuumText } from '../voice/vacuum.js';

export const vacuumDatabase = pair(
  OPS.vacuum_database,
  body(OPS.vacuum_database, {
    execute: Effect.fnUntraced(function* () {
      const verdict = yield* (yield* MachineStore).vacuum();
      if (verdict.outcome !== 'vacuumed') {
        const refusal = vacuumRefusal(verdict);
        return yield* new GateRefusal(refusal.code, refusal.reason, refusal.unblock);
      }
      return { status: 'ok' as const, vacuum: verdict.vacuum };
    }),
    voice: said(vacuumText),
    display: vacuumDisplay,
  }),
);
