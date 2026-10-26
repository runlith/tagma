import { defected } from '@runlith/activity/Activity';
import { ActivityCause } from '@runlith/activity/cause';
import type { ActivityActor, ActivityTrigger } from '@runlith/activity/fact';
import { type Cause, Effect } from 'effect';
import type { Caller } from '../platform/contract/wire/caller.js';

export type CallStand = {
  readonly thread: string | null;
  readonly run: string | null;
  readonly project: number | null;
};

export const caused = <A, E, R>(id: string, caller: Caller, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(Effect.withSpan(work, id), ActivityCause, { actor: actorOf(caller), trigger: triggerOf(id) });

export const callDefected = (id: string, caller: Caller, stand: CallStand, cause: Cause.Cause<unknown>): Effect.Effect<void> =>
  defected(cause, id, {
    thread: stand.thread ?? undefined,
    run: stand.run ?? undefined,
    outside: stand.run === null ? undefined : { run: stand.run },
    project: stand.thread === null ? (stand.project ?? undefined) : undefined,
    actor: actorOf(caller),
    trigger: triggerOf(id),
  });

const triggerOf = (id: string): ActivityTrigger => ({ kind: 'operation', refs: [id] });

function actorOf(caller: Caller): ActivityActor {
  const actor = caller.actor;
  if (actor.kind === 'operator') return { kind: 'operator' };
  if (actor.kind === 'thread') return { kind: 'thread', id: actor.threadId };
  if (actor.kind === 'external') return { kind: 'session', id: `external:${actor.name}` };
  return { kind: 'session', id: `${actor.session.harness}:${actor.session.key}` };
}
