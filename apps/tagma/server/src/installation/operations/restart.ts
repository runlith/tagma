import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Succession } from '../contract/service/succession.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import { RESTART_WORDS } from '../contract/wire/words.js';

export const restartServer = pair(
  OPS.restart_server,
  body(OPS.restart_server, {
    execute: Effect.fnUntraced(function* () {
      const restart = yield* (yield* Succession).restart().pipe(
        Effect.mapError((refused) => {
          switch (refused._tag) {
            case 'SuccessorFailed':
              return new GateRefusal('successor-left', `${refused.detail}; this server keeps running`, [
                `${refused.log} — what the successor printed, under the start marked "on restart"`,
              ]).saying(RESTART_WORDS['successor-left']);
            case 'HostUnprepared':
              return new GateRefusal('host-unprepared', `${refused.detail}; this server and its execution host keep running`, [
                'read_machine_state — what the execution host answers now; restart again once it answers',
              ]).saying(RESTART_WORDS['host-unprepared']);
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
