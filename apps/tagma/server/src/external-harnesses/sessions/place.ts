import { Effect } from 'effect';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { Worlds } from '../../executions/contract/service/worlds.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { TargetPreparation } from '../../threads/contract/service/preparation.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';

export const makeSessionPlace = Effect.fnUntraced(function* () {
  const lookup = yield* ThreadLookup;
  const targets = yield* TargetPreparation;
  const worlds = yield* Worlds;
  return Effect.fnUntraced(function* (threadId: string) {
    const row = yield* lookup.find(threadId, OPERATOR_PRINCIPAL);
    if (!row) return yield* threadCallFailed(new Error(`Session ${threadId} is gone.`));
    const admitted = yield* targets
      .of({ id: row.id, projectId: row.projectId }, { kind: 'tools', runId: null, context: null }, (request) =>
        worlds.of({ thread: row, at: request.at, root: request.root }),
      )
      .pipe(Effect.catchTag('WorldUnavailable', (cause) => Effect.fail(threadCallFailed(cause))));
    return {
      projectId: row.projectId,
      root: admitted.world.root,
      scratch: admitted.world.scratch,
      selection: { provider: row.provider, account: row.account },
    };
  });
});

export type SessionHome = Effect.Success<ReturnType<typeof makeSessionPlace>>;

export type HomePlace = Effect.Success<ReturnType<SessionHome>>;
