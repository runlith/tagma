import { Effect } from 'effect';
import { StripComments } from '../contract/service/sweep.js';
import { CHANGE_WRITES as OPS } from '../contract/wire/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { writeSubject } from '../../platform/contract/service/subjects.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { checkoutAt } from '../../workspace/roots/proof.js';

type SweepRefusal = GateRefusal<(typeof OPS)['strip_comments']['refusals'][number]> | StoreFailure;

export const stripComments = pair(
  OPS.strip_comments,
  body(OPS.strip_comments, {
    files: (input) => [writeSubject(input.path)],
    execute: Effect.fnUntraced(function* (input, _prepared, caller) {
      if (caller.actor.kind !== 'thread') {
        return yield* new GateRefusal('project-required', 'Comment writes are recorded for a session, and this caller is not one.', [
          'Run the sweep from a thread working in the checkout.',
        ]);
      }
      const workspace = yield* CallerWorkspace;
      if (workspace === null) {
        return yield* new GateRefusal(
          'no-record',
          'This caller writes no file of a checkout, so the sweep has no change record to write.',
          ['Run the sweep from a thread working in the checkout.'],
        );
      }
      const checkout = yield* Effect.mapError(
        checkoutAt(yield* CheckoutPaths, caller.actor.projectId, workspace.root),
        (failure) =>
          new GateRefusal('record-unread', `the checkout this sweep writes in cannot be placed: ${failure.reason}`, [
            'ask again once the checkout reads',
          ]),
      );
      const sweep = yield* StripComments;
      const swept = yield* Effect.mapError(
        sweep.strip({
          projectId: caller.actor.projectId,
          threadId: caller.actor.threadId,
          root: workspace.root,
          checkout,
          path: input.path,
        }),
        (failure): SweepRefusal =>
          failure instanceof GateRefusal || failure._tag === 'SqlError' || failure._tag === 'EffectDrizzleQueryError'
            ? failure
            : new GateRefusal(failure._tag === 'WorkspaceRefused' ? 'path-outside-tree' : 'repository-unread', failure.message, [
                'read the failure above, correct the checkout or its record, then ask again',
              ]),
      );
      return { status: 'swept' as const, ...swept };
    }),
  }),
);
