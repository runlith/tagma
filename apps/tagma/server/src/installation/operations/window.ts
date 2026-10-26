import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { RestartRecords } from '../contract/service/restarts.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';

export const reportRestartWindow = pair(
  OPS.report_restart_window,
  body(OPS.report_restart_window, {
    execute: Effect.fnUntraced(function* (input) {
      const records = yield* RestartRecords;
      const restart = yield* records
        .report(input)
        .pipe(
          Effect.mapError(
            (failure) =>
              new GateRefusal(
                failure._tag === 'RestartWindowRefused' ? 'restart-window-refused' : 'restart-record-unwritable',
                failure.detail,
                [
                  failure._tag === 'RestartWindowRefused'
                    ? 'read_machine_state — read the current restart before reporting'
                    : 'restore writable space in the data directory, then report the same window again',
                ],
              ),
          ),
        );
      return { status: 'recorded' as const, restart };
    }),
  }),
);
