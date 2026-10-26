import { activity } from '@runlith/activity/Activity';
import { ActivityCause } from '@runlith/activity/cause';
import { ActivityLog } from '@runlith/activity/log';
import { RUN, type RunResult } from '@runlith/agent/activities';
import type { RequestLanded } from '@runlith/agent/thread/run/requests';
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { sumUsage, type Usage } from '@runlith/llm/schema/events';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { HarnessTurnEnded } from './turns.js';

type Closed = { readonly ended: HarnessTurnEnded; readonly usage: Usage | null };

export type ActivityStart = { readonly turn: string; readonly model: string | null; readonly reasoning: string | null };

type Held = {
  readonly ended: Deferred.Deferred<Closed>;
  readonly fiber: Fiber.Fiber<Closed>;
  spent: Usage | null;
};

export class RunActivities {
  private readonly held = new Map<string, Held>();

  constructor(
    private readonly inbox: ThreadInbox['Service'],
    private readonly log: ActivityLog,
    private readonly scope: Scope.Scope,
  ) {}

  readonly open = Effect.fnUntraced(function* (
    this: RunActivities,
    thread: string,
    name: HarnessName,
    started: ActivityStart,
    seed: readonly string[] = [],
  ) {
    if (this.held.has(started.turn)) return;
    const refs = [...new Set([...(yield* this.inbox.delivered(thread, started.turn)), ...seed])];
    yield* this.observe(thread, name, started, refs);
  });

  readonly observe = Effect.fnUntraced(function* (
    this: RunActivities,
    thread: string,
    name: HarnessName,
    started: ActivityStart,
    refs: readonly string[],
  ) {
    const { held, log, scope } = this;
    if (held.has(started.turn)) return;
    const ready = Deferred.makeUnsafe<void>();
    const ended = Deferred.makeUnsafe<Closed>();
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkIn(
          activity(
            RUN,
            {
              provider: name,
              model: started.model,
              reasoning: started.reasoning,
              modelSteps: 'unobserved',
            },
            Effect.andThen(Deferred.succeed(ready, undefined), Deferred.await(ended)),
            {
              thread,
              run: started.turn,
              actor: { kind: 'thread', id: thread },
              trigger: refs.length === 0 ? null : { kind: 'inbox', refs },
              ended: (exit) => (Exit.isSuccess(exit) ? ending(exit.value) : { message: Cause.pretty(exit.cause) }),
            },
          ).pipe(Effect.provideService(ActivityCause, null), Effect.provideService(ActivityLog, log)),
          scope,
        );
        held.set(started.turn, { ended, fiber, spent: null });
        yield* restore(Deferred.await(ready));
      }),
    );
  });

  requested(request: RequestLanded): Effect.Effect<void> {
    return Effect.sync(() => {
      const standing = this.held.get(request.run.id);
      if (standing !== undefined && request.usage !== null) standing.spent = sumUsage(standing.spent, request.usage);
    });
  }

  has(runId: string): boolean {
    return this.held.has(runId);
  }

  readonly end = Effect.fnUntraced(function* (this: RunActivities, ended: HarnessTurnEnded, committed?: Usage | null) {
    const standing = this.held.get(ended.turn);
    if (standing === undefined) return;
    const usage = committed === undefined ? (ended.rest === undefined ? standing.spent : sumUsage(standing.spent, ended.rest)) : committed;
    yield* Deferred.succeed(standing.ended, { ended, usage });
    yield* Fiber.await(standing.fiber);
    this.held.delete(ended.turn);
  }, Effect.uninterruptible);
}

function ending({ ended, usage }: Closed) {
  const result: RunResult = {
    finish: ended.status,
    usage: usage ?? undefined,
  };
  return {
    outcome: ended.status === 'completed' ? ('ok' as const) : ended.status === 'aborted' ? ('cancelled' as const) : ('failed' as const),
    reason: ended.status === 'failed' ? 'HarnessTurnFailed' : (ended.stoppedBy ?? undefined),
    message: ended.failure ?? undefined,
    result,
  };
}
