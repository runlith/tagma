import { Git } from '@runlith/git/Git';
import { Effect, Option } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { SignedCall } from '../../platform/contract/service/writers.js';
import { nativeThreadIdOf } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { CallerWorkspace, WorkingOrigins } from '../../workspace/contract/service/places.js';
import { ChangeRecord } from '../contract/service/record.js';
import type { LandingOrigin } from '../contract/service/prepared.js';

type GitRunner = (
  act: { readonly projectId: number; readonly thread: ThreadId; readonly root: string; readonly toolCall?: string },
  platform: Git['Service'],
) => Effect.Effect<Git['Service'], StoreFailure>;

export const landingPlace = Effect.fn('submit_work.place')(function* (projectId: number, caller: Caller, runner: GitRunner) {
  const thread = nativeThreadIdOf(caller.actor);
  const workspace = yield* CallerWorkspace;
  if (thread === null || caller.actor.kind !== 'thread') return yield* unrecordedPlace(projectId, workspace?.root ?? null);
  if (workspace === null || workspace.origin === null) {
    return yield* new GateRefusal(
      'root-unproven',
      'nothing could prove the identity of the tree this session writes in, so its held paths cannot be named',
      ['commit the paths by hand: git commit -- <paths>'],
    );
  }
  const checkout = yield* Effect.mapError(
    (yield* ChangeRecord).checkout(projectId, workspace.root),
    (failure) =>
      new GateRefusal('root-unproven', `the checkout this session writes in cannot be placed: ${failure.reason}`, [
        'ask again once the checkout reads',
      ]),
  );
  const signedCall = yield* SignedCall;
  const git = yield* Git;
  const hosted = yield* runner(
    {
      projectId: caller.actor.projectId,
      thread: ThreadId.make(thread),
      root: workspace.root,
      toolCall: signedCall ?? undefined,
    },
    git,
  );
  return {
    thread,
    git,
    hosted,
    root: workspace.root,
    checkout,
    origin: { ...workspace.origin, work: { projectId: caller.actor.projectId, threadId: thread } } satisfies LandingOrigin,
  };
});

const unrecordedPlace = Effect.fnUntraced(function* (projectId: number, named: string | null) {
  if (named === null) {
    return yield* new GateRefusal(
      'root-unproven',
      'this caller writes through tools the change record does not see and its call stands in no checkout, so nothing names where to land',
      ['name checkout, or project for its main checkout'],
    );
  }
  const origins = yield* Effect.serviceOption(WorkingOrigins);
  const proved = Option.isNone(origins) ? null : yield* origins.value.rootOf(named);
  if (proved === null) {
    return yield* new GateRefusal('root-unproven', `nothing could prove the identity of ${named}, so no commit can land in it`, [
      'name a registered checkout root',
    ]);
  }
  const checkout = yield* Effect.mapError(
    (yield* ChangeRecord).checkout(projectId, named),
    (failure) =>
      new GateRefusal('root-unproven', `the checkout ${named} cannot be placed: ${failure.reason}`, ['ask again once the checkout reads']),
  );
  const git = yield* Git;
  return {
    thread: null,
    git,
    hosted: git,
    root: named,
    checkout,
    origin: { ...proved, work: null } satisfies LandingOrigin,
  };
});
