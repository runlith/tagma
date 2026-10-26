import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { CheckoutPlaces } from '../../workspace/contract/service/checkouts.js';
import { ChangeScope } from '../contract/service/scope.js';
import { Authorship } from '../contract/service/authorship.js';
import { CHANGE_READS as OPS } from '../contract/wire/operations.js';
import { authorshipRefusal } from '../threadFiles/failures.js';

export const readAuthorship = pair(
  OPS.read_authorship,
  body(OPS.read_authorship, {
    execute: Effect.fnUntraced(function* (input) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const rootId = yield* (yield* CheckoutPlaces).rootOf({ projectId, cwd: undefined }, input.rootId);
      const authorship = yield* Effect.mapError(
        (yield* Authorship).read(rootId, input.path, input.context, input.open, input.commit, input.base, input.side),
        authorshipRefusal,
      );
      return { status: 'ok' as const, authorship };
    }),
  }),
);
