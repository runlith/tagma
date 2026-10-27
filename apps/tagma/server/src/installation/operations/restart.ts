import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { MachineHost } from '../contract/service/machineHost.js';
import { Succession } from '../contract/service/succession.js';
import type { HostEnding } from '../contract/wire/newHost.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import { RESTART_WORDS } from '../contract/wire/words.js';

const NAMED = 3;

const costOf = (ends: ReadonlyArray<HostEnding> | null): string => {
  if (ends === null) return 'what the standing host runs could not be read';
  if (ends.length === 0) return 'the standing host runs nothing, so nothing ends';
  const named = ends.slice(0, NAMED).map((ending) => ending.title);
  const rest = ends.length - named.length;
  return `it ends ${ends.length}: ${named.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
};

export const restartServer = pair(
  OPS.restart_server,
  body(OPS.restart_server, {
    execute: Effect.fnUntraced(function* (input) {
      const machineHost = yield* MachineHost;
      const restart = yield* (yield* Succession).restart(input.host).pipe(
        Effect.catchTag('HostUnprepared', (refused) =>
          Effect.flatMap(machineHost.endings, (ends) =>
            Effect.fail(
              new GateRefusal('host-unprepared', `${refused.detail}; this server and its execution host keep running`, [
                `restart_server {"host":"replace"} — update anyway with a new execution host; ${costOf(ends)}`,
                'read_machine_state — what the execution host answers now, and newHost.ends for everything a new host ends',
              ]).saying(RESTART_WORDS['host-unprepared']),
            ),
          ),
        ),
        Effect.mapError((refused) => {
          switch (refused._tag) {
            case 'GateRefusal':
              return refused;
            case 'SuccessorFailed':
              return new GateRefusal('successor-left', `${refused.detail}; this server keeps running`, [
                `${refused.log} — what the successor printed, under the start marked "on restart"`,
              ]).saying(RESTART_WORDS['successor-left']);
            case 'SuccessionRefused':
              return new GateRefusal('no-successor', `${refused.detail}; this server keeps running`, [
                'read_machine_state — the next installations this machine’s source offers; install one, then restart',
              ]).saying(RESTART_WORDS['no-successor']);
          }
        }),
      );
      return { status: 'restarting' as const, restart };
    }),
  }),
);
