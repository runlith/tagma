import { Effect } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import { TerminalGrants } from '../../executions/contract/service/grants.js';
import { Worlds } from '../../executions/contract/service/worlds.js';
import { WorkspaceInputs } from '../contract/service/inputs.js';
import type { RunWebs } from '../turns/runWebs.js';
import type { CommandDescriptions } from '../turns/commandDescriptions.js';

export const makeSettledRelease = Effect.fnUntraced(function* ({
  webs,
  descriptions,
}: {
  readonly webs: RunWebs;
  readonly descriptions: CommandDescriptions;
}) {
  const grants = yield* TerminalGrants;
  const sourceCache = yield* WorkspaceInputs;
  const worlds = yield* Worlds;
  return Effect.fn('native.releaseSettledRun')(function* ({ threadId, runId }: { readonly threadId: string; readonly runId: string }) {
    return yield* grants.endRun(Principal.make(`thread:${threadId}`), runId, 'run-ended').pipe(
      Effect.tap((ended) => {
        const pending = ended.filter((ending) => ending.fence === 'pending');
        return pending.length === 0
          ? Effect.void
          : Effect.logWarning('terminal grant revocation pending host fence', { threadId, runId, pending: pending.length });
      }),
      Effect.andThen(sourceCache.releaseRun(threadId, runId)),
      Effect.ensuring(worlds.releaseRun(threadId, runId)),
      Effect.ensuring(webs.release(runId)),
      Effect.ensuring(descriptions.release(runId)),
    );
  });
});
