import { Effect } from 'effect';
import type { Actor } from '../../platform/contract/wire/actor.js';
import type { CallerWorkspace, WorkingOrigins } from '../../workspace/contract/service/places.js';
import type { WorkingRoot } from '../../workspace/contract/wire/place.js';

export const workspaceAt = Effect.fn('invocation.workspaceAt')(function* (
  origins: WorkingOrigins['Service'],
  actor: Actor,
  root: string,
): Effect.fn.Return<{ readonly place: NonNullable<CallerWorkspace['Service']>; readonly root: WorkingRoot | null }> {
  const origin = actor.kind === 'thread' ? yield* origins.of({ projectId: actor.projectId, threadId: actor.threadId }, root) : null;
  const proved = origin ?? (yield* origins.rootOf(root));
  return { place: { root: proved?.root.path ?? root, origin }, root: proved };
});
