import { type Context, Effect } from 'effect';
import type { Raised } from '../permissions/vocabulary';
import type { ThreadRunStoppedBy } from '../thread/ending';
import type { ThreadReadFailure, ThreadRecord } from '../thread/record';
import type { ThreadCallBroke } from '../thread/ThreadBorder';
import { planeRefused } from './planeRefusal';
import type { PlaneRefusalCode } from './refusals';
import type { Threads } from './threads';
import { deletionFact } from './collaborationVerbs';

export type Standing = 'child' | 'descendant' | 'self' | 'ancestor' | 'outside';

export type Reached = { readonly thread: ThreadRecord; readonly standing: Standing };

export type Within = 'child' | 'descendant';

type ThreadsShape = Context.Service.Shape<typeof Threads>;

export function resolveThread(
  threads: ThreadsShape,
  caller: ThreadRecord,
  address: string,
): Effect.Effect<ThreadRecord | null, ThreadReadFailure> {
  return Effect.flatMap(threads.find(address, caller.principal), (thread) =>
    thread === null ? threads.named(caller.principal, caller.spawnRootId, address) : Effect.succeed(thread),
  );
}

export const reach = Effect.fnUntraced(function* (
  threads: ThreadsShape,
  caller: ThreadRecord,
  threadId: string,
): Effect.fn.Return<Reached | null, ThreadReadFailure> {
  const thread = yield* resolveThread(threads, caller, threadId);
  if (thread === null) return null;
  if (thread.id === caller.id) return { thread, standing: 'self' };
  if (thread.parentThreadId === caller.id) return { thread, standing: 'child' };
  const below = yield* threads.lineage(thread.id, caller.principal);
  if (below.ancestors.some((ancestor) => ancestor.id === caller.id)) return { thread, standing: 'descendant' };
  const [own] = yield* ownLineage(threads, caller, [thread]);
  return { thread, standing: own === undefined ? 'outside' : own.lineage };
});

export type OwnLineage = { readonly thread: ThreadRecord; readonly lineage: 'self' | 'ancestor' };

export const ownLineage = Effect.fnUntraced(function* (
  threads: ThreadsShape,
  caller: ThreadRecord,
  targets: readonly ThreadRecord[],
): Effect.fn.Return<readonly OwnLineage[], ThreadReadFailure> {
  const above = targets.some((target) => target.id !== caller.id)
    ? new Set((yield* threads.lineage(caller.id, caller.principal)).ancestors.map((ancestor) => ancestor.id))
    : new Set<string>();
  return targets.flatMap((thread): OwnLineage[] =>
    thread.id === caller.id ? [{ thread, lineage: 'self' }] : above.has(thread.id) ? [{ thread, lineage: 'ancestor' }] : [],
  );
});

const STANDING_FACTS: Record<Exclude<Standing, 'child'>, (id: string) => string> = {
  descendant: (id) => `thread ${id} stands below a child of the calling thread, not directly under it`,
  self: (id) => `thread ${id} is the calling thread itself`,
  ancestor: (id) => `thread ${id} is an ancestor of the calling thread`,
  outside: (id) => `thread ${id} stands outside the calling thread's subtree`,
};

const CROSSINGS = {
  child: { id: 'not-a-child', label: 'Not a child' },
  descendant: { id: 'not-a-descendant', label: 'Outside the subtree' },
} as const satisfies Record<Within, { readonly id: PlaneRefusalCode; readonly label: string }>;

export function crossing(reached: Reached | null, within: Within): readonly Raised[] {
  if (reached === null || reached.standing === 'child') return [];
  if (within === 'descendant' && reached.standing === 'descendant') return [];
  return [{ condition: CROSSINGS[within].id, fact: STANDING_FACTS[reached.standing](reached.thread.id) }];
}

export const unreached = Effect.fnUntraced(function* (
  threads: ThreadsShape,
  caller: ThreadRecord,
  address: string,
): Effect.fn.Return<never, ThreadReadFailure | ThreadCallBroke> {
  const gone = yield* threads.deleted(caller.principal, caller.spawnRootId, address);
  return yield* gone === null
    ? planeRefused('thread-unknown', `no thread ${address} stands under this owner.`)
    : planeRefused('thread-unknown', `${deletionFact(gone)}, so no act reaches it any more.`, [
        'spawn a fresh agent briefed with its last report for the work it was doing',
      ]);
});

export function crossed(reached: Reached, within: Within, asked: readonly string[]): Effect.Effect<Reached, ThreadCallBroke> {
  const unasked = crossing(reached, within).find((raised) => !asked.includes(raised.condition));
  return unasked === undefined ? Effect.succeed(reached) : planeRefused(CROSSINGS[within].id, unasked.fact);
}

export function stopperOf(reached: Reached): ThreadRunStoppedBy {
  return reached.standing === 'child' ? 'parent' : 'agent';
}
