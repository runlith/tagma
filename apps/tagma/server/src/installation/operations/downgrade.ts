import { Effect, Option } from 'effect';
import { said } from '../../platform/contract/service/presentation.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ConsoleKeyRollback, DowngradeSteps } from '../contract/service/steps.js';
import type { DowngradeStep } from '../contract/wire/downgrade.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import { downgradeText } from '../voice/downgrade.js';

export const downgradePreflight = Effect.fn('prepare_downgrade.preflight')(function* () {
  const bound = yield* Effect.serviceOption(DowngradeSteps);
  if (Option.isNone(bound)) {
    return {
      step: 'downgrade-preflight',
      state: 'unbound',
      detail: 'no owner has bound the downgrade preflight, so the commit queue was neither closed nor measured',
    } satisfies DowngradeStep;
  }
  yield* bound.value.close();
  const { waiting, unread } = yield* bound.value.drained();
  if (waiting > 0 || unread > 0) {
    yield* bound.value.reopen();
    return yield* new GateRefusal(
      'queue-undrained',
      `the commit queue holds ${waiting} waiting and ${unread} unread lines, and the previous binary skips a line it cannot read and loses its commit`,
      ['prepare_downgrade — ask again once the queue has drained'],
    );
  }
  return {
    step: 'downgrade-preflight',
    state: 'passed',
    detail: 'the commit queue admits no new line and holds none waiting or unread',
  } satisfies DowngradeStep;
});

export const prepareDowngrade = pair(
  OPS.prepare_downgrade,
  body(OPS.prepare_downgrade, {
    execute: Effect.fnUntraced(function* ({ snapshot }) {
      const checked = yield* downgradePreflight();
      const rollback = yield* Effect.serviceOption(ConsoleKeyRollback);
      const skipped = (detail: string) => ({ step: 'console-key-rollback', state: 'skipped', detail }) satisfies DowngradeStep;
      if (Option.isNone(rollback)) {
        const unbound = {
          step: 'console-key-rollback',
          state: 'unbound',
          detail: 'no owner has bound the console-key rollback',
        } satisfies DowngradeStep;
        return { status: 'ready' as const, steps: [checked, unbound], losses: [] };
      }
      if (checked.state !== 'passed') {
        return {
          status: 'ready' as const,
          steps: [checked, skipped('the rollback writes only after the downgrade preflight passes')],
          losses: [],
        };
      }
      if (snapshot === undefined) {
        return {
          status: 'ready' as const,
          steps: [checked, skipped('no snapshot copy was named for the previous binary to open')],
          losses: [],
        };
      }
      const losses = yield* rollback.value
        .copyToSnapshot(snapshot)
        .pipe(
          Effect.mapError(
            (failed) =>
              new GateRefusal('rollback-failed', `the console keys could not be written into ${failed.path}: ${failed.reason}`, [
                'tagma op prepare_downgrade — name a snapshot copy that stands as a store file',
              ]),
          ),
        );
      const written = {
        step: 'console-key-rollback',
        state: 'written',
        detail: `the console keys were written into ${snapshot}`,
      } satisfies DowngradeStep;
      return { status: 'ready' as const, steps: [checked, written], losses };
    }),
    voice: said(downgradeText),
  }),
);
