import type { Raised } from '@runlith/agent/permissions';
import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { GateRefusal, type Unblock, type Words } from '../../platform/contract/wire/refusal.js';
import { NextInstallation } from '../contract/service/next.js';
import type { Installing } from '../contract/wire/next.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import { INSTALL_WORDS } from '../contract/wire/words.js';

const refusal = <Code extends keyof typeof INSTALL_WORDS>(refused: {
  readonly code: Code;
  readonly reason: string;
  readonly unblock: Unblock;
  readonly words?: Words;
}) => new GateRefusal(refused.code, refused.reason, refused.unblock, undefined, refused.words ?? INSTALL_WORDS[refused.code]);

const replacing = (running: Installing): Raised => ({
  condition: 'install-running',
  fact: `${running.title} ${running.target} installs since ${running.since}${running.then === 'restart' ? ' and restarts the server once it lands' : ''}; this one stops it first`,
});

export const installNext = pair(
  OPS.install_next,
  body(OPS.install_next, {
    prepare: Effect.fn('install_next.terms')(function* ({ offer }) {
      const next = yield* NextInstallation;
      const running = yield* next.installing;
      const frame = yield* next.reading;
      const named = [...frame.offers, ...(frame.back === null ? [] : [frame.back])].find((each) => each.id === offer) ?? null;
      return {
        running,
        offer: named,
        consents: running === null || running.step === 'restart' ? [] : [replacing(running)],
      };
    }),
    execute: Effect.fnUntraced(function* ({ offer, then }, { running }) {
      const started = yield* (yield* NextInstallation).install(offer, then ?? null, running?.since ?? null).pipe(Effect.mapError(refusal));
      return { status: 'started' as const, ...started };
    }),
  }),
);

export const checkForUpdates = pair(
  OPS.check_for_updates,
  body(OPS.check_for_updates, {
    execute: Effect.fnUntraced(function* () {
      return { status: 'checked' as const, next: yield* (yield* NextInstallation).check };
    }),
  }),
);

export const stopInstalling = pair(
  OPS.stop_installing,
  body(OPS.stop_installing, {
    execute: Effect.fnUntraced(function* () {
      const installed = yield* (yield* NextInstallation).stop().pipe(Effect.mapError(refusal));
      return { status: 'ended' as const, installed };
    }),
  }),
);
