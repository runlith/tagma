import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Cause, Effect, Fiber, Scope } from 'effect';
import { declare } from '@runlith/held/Held';
import { Holding } from '@runlith/held/holding';
import type { ScreenAnswer } from '@runlith/executions/protocol/presentation';
import type { ScreenAsk } from '../contract/service/adapter.js';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import { readsScreen, sameScreenAsk, widgetStands } from '../adapter/screenAsk.js';
import { harnessAdapter } from '../contract/service/table.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalScreens } from '../../executions/contract/service/records.js';
import { HarnessSessionStore } from '../store/sessions.js';
import type { TerminalAsks } from './terminal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';

type Job = { readonly key: string; fiber: Fiber.Fiber<void> | null };

type Seen = { previous: ScreenAsk | null; announced: ScreenAsk | null; on: string | null; unswept: boolean };

export type WidgetCleared = (threadId: string) => Effect.Effect<void, HarnessFailure>;

export type ScreenAskSeen = { readonly _tag: 'Read'; readonly ask: ScreenAsk | null } | { readonly _tag: 'Unreadable' };

export const QUIET_BEAT_MS = 5_000;

const CONFIRM_BEAT_MS = 250;

const HELD_BEAT_MS = 1_000;

const jobsHeld = declare<string>({
  name: 'external-harnesses/screen-ask-jobs',
  owner: 'external-harnesses',
  rank: 900,
  key: () => 'jobs',
  concurrency: 1,
  threshold: '30 seconds',
  ceilings: {
    hold: '5 minutes',
    wait: '5 minutes',
    leaves:
      'a cut job change stops where it stood; the job table keeps its last consistent entry and the next observation of the thread reconciles it',
  },
  external: 'none',
});

export class HarnessScreenAsks {
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly store: HarnessSessionStore,
    private readonly terminals: Terminals['Service'],
    private readonly screens: TerminalScreens['Service'],
    private readonly asks: TerminalAsks,
    private readonly cleared: WidgetCleared,
    private readonly scope: Scope.Scope,
  ) {}

  static readonly make = Effect.fnUntraced(function* (
    store: HarnessSessionStore,
    terminals: Terminals['Service'],
    screens: TerminalScreens['Service'],
    asks: TerminalAsks,
    cleared: WidgetCleared,
  ) {
    return new HarnessScreenAsks(store, terminals, screens, asks, cleared, yield* Effect.scope);
  });

  observed(threadId: string, facet: ExternalSession): Effect.Effect<void, StoreFailure | GateRefusal> {
    return this.store
      .binding(threadId)
      .pipe(Effect.flatMap((binding) => jobsHeld.hold('jobs', Effect.uninterruptible(this.reconcile(threadId, facet, binding)))))
      .pipe(
        Effect.catchTags({
          HoldStalled: () =>
            Effect.fail(
              new GateRefusal('harness-jobs-busy', "the screen-ask job table was held too long to reconcile this thread's observation", [
                'the next observation of the thread reconciles it',
              ]),
            ),
          HoldCut: (cut) =>
            Effect.fail(
              new GateRefusal('harness-jobs-cut', `the screen-ask job table change ran past its ceiling: ${cut.leaves}`, [
                'the next observation of the thread reconciles it',
              ]),
            ),
        }),
      );
  }

  private readonly reconcile = Effect.fnUntraced(function* (
    this: HarnessScreenAsks,
    threadId: string,
    facet: ExternalSession,
    binding: Effect.Success<ReturnType<HarnessSessionStore['binding']>>,
  ) {
    const prior = this.jobs.get(threadId);
    const terminal = binding?.adapter === 'terminal';
    const eligible =
      harnessSessionActive(facet.session) &&
      terminal &&
      facet.session.state === 'running' &&
      facet.execution !== null &&
      readsScreen(harnessAdapter(facet.name));
    const key = eligible ? JSON.stringify([facet.session!.id, facet.execution]) : null;
    if (prior !== undefined && prior.key === key) return;
    if (prior !== undefined) {
      this.jobs.delete(threadId);
      if (prior.fiber !== null) yield* Fiber.interrupt(prior.fiber);
    }
    if (key === null) return;
    const job: Job = { key, fiber: null };
    this.jobs.set(threadId, job);
    job.fiber = yield* Effect.forkIn(
      this.watch(threadId, job)
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (this.jobs.get(threadId) === job) this.jobs.delete(threadId);
            }),
          ),
        )
        .pipe(Effect.provideService(Holding, { tokens: [], tickets: [], within: [] })),
      this.scope,
      { startImmediately: false, uninterruptible: false },
    );
  });

  private watch(threadId: string, job: Job): Effect.Effect<void> {
    const seen: Seen = { previous: null, announced: null, on: null, unswept: true };
    return this.looking(threadId, job, seen).pipe(
      Effect.tapCause((cause) => Effect.logWarning('screen ask observation could not continue', { threadId, cause: Cause.pretty(cause) })),
      Effect.orDie,
    );
  }

  private readonly looking = Effect.fnUntraced(function* (this: HarnessScreenAsks, threadId: string, job: Job, seen: Seen) {
    while (true) {
      const beat = yield* Effect.result(this.beat(threadId, job, seen));
      if (beat._tag === 'Failure') {
        yield* Effect.logWarning('screen ask observation will look again', { threadId, failure: String(beat.failure) });
        yield* Effect.sleep(QUIET_BEAT_MS);
      } else if (beat.success === null) {
        return;
      } else {
        yield* Effect.sleep(beat.success);
      }
    }
  });

  private readonly beat = Effect.fnUntraced(function* (
    this: HarnessScreenAsks,
    threadId: string,
    job: Job,
    seen: Seen,
  ): Effect.fn.Return<number | null, HarnessFailure> {
    const facet = yield* this.store.read(threadId);
    if (facet === null || !harnessSessionActive(facet.session) || JSON.stringify([facet.session.id, facet.execution]) !== job.key)
      return null;
    const read = yield* this.readAsk(facet);
    const run = facet.turn?.run ?? null;
    const held = (facet.unread ?? []).some((entry) => entry.send === 'intended');
    if (seen.on !== run) {
      seen.on = run;
      seen.announced = null;
      seen.unswept = true;
    }
    if (read._tag === 'Read') {
      const ask = read.ask;
      if (widgetStands(ask) && seen.previous !== null && sameScreenAsk(seen.previous, ask)) {
        if (seen.announced === null || !sameScreenAsk(seen.announced, ask) || !this.asks.shows(threadId, ask)) {
          if (seen.announced !== null || seen.unswept) seen.unswept = !(yield* this.asks.widgetGone(threadId, ask));
          seen.announced = null;
          if (yield* this.asks.widgetSeen(threadId, ask)) seen.announced = ask;
          else return QUIET_BEAT_MS;
        } else if (seen.unswept) seen.unswept = !(yield* this.asks.widgetGone(threadId, ask));
      } else if (ask === null && (seen.announced !== null || seen.unswept)) {
        seen.unswept = !(yield* this.asks.widgetGone(threadId));
        seen.announced = null;
      }
      const settled = !widgetStands(seen.previous) && !widgetStands(ask);
      seen.previous = ask;
      if (settled && held) yield* this.cleared(threadId);
    }
    if (read._tag === 'Read' && widgetStands(read.ask) && (seen.announced === null || !sameScreenAsk(seen.announced, read.ask)))
      return CONFIRM_BEAT_MS;
    return held ? HELD_BEAT_MS : QUIET_BEAT_MS;
  });

  private readAsk(facet: ExternalSession): Effect.Effect<ScreenAskSeen> {
    const execution = facet.execution;
    if (execution === null) return Effect.succeed({ _tag: 'Unreadable' });
    const reader = harnessAdapter(facet.name).screenAskOf;
    return this.terminals.record(execution.execution, execution.incarnation).pipe(
      Effect.flatMap((record) =>
        record === null
          ? Effect.succeed({ _tag: 'Unreadable' } satisfies ScreenAskSeen)
          : this.screens.screen(record.execution).pipe(
              Effect.map((answer: ScreenAnswer): ScreenAskSeen => {
                if (answer._tag !== 'ScreenTextFrame') return { _tag: 'Unreadable' };
                return { _tag: 'Read', ask: reader(screenLines(answer)) };
              }),
            ),
      ),
      Effect.catch(() => Effect.succeed({ _tag: 'Unreadable' } satisfies ScreenAskSeen)),
    );
  }
}
