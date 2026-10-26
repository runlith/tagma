import { Deferred, Effect, Exit, Queue } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { Service } from '@runlith/layer/key';
import type { ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';
import { delegation as delegationKey } from '@tagma/server/threads/contract/wire/settings';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { hasScreen } from '../external/Surface.svelte.js';
import { declared } from '../authorityModes.js';
import { ThreadsRepo } from '../Repo.js';
import {
  type ApproverPick,
  type ApprovingReading,
  type AuthorityView,
  type DelegationPick,
  DELEGATION_OWN,
  type DelegationReading,
  type ModeAction,
} from './authority.js';
import { ThreadEffects } from './ThreadEffects.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';
import { refusedBy, refusedCall, ThreadRefused } from './ThreadRefused.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;
type Settings = ReturnType<typeof SettingsRepo.use>;

type ModeIntent = { readonly mode: string; readonly done: Deferred.Deferred<void, ThreadRefused>; readonly shaped: () => void };

export class ThreadAuthority extends Service<ThreadAuthority>()('ThreadAuthority', { tier: 'thread' }) implements AuthorityView {
  static *make() {
    return new ThreadAuthority(
      yield* ThreadFeed,
      yield* ThreadEffects,
      yield* Live,
      yield* ThreadsRepo,
      yield* SettingsRepo,
      (yield* ProjectRung.Current).projectId,
    );
  }

  private delegating = $state(false);
  private intended = $state<string | null>(null);
  private switched = $state.raw<WireThread['delegation'] | null>(null);
  private refused = $state<string | null>(null);
  private draining = false;
  private readonly intents = Effect.runSync(Queue.unbounded<ModeIntent>());
  private readonly waiting = new Set<Deferred.Deferred<void, ThreadRefused>>();
  private readonly shaping = new Set<() => void>();

  constructor(
    private readonly feed: ThreadFeed,
    private readonly effects: ThreadEffects,
    private readonly live: LiveConnection,
    private readonly threads: Threads,
    private readonly settings: Settings,
    private readonly projectId: number,
  ) {
    super();
  }

  get busy(): boolean {
    return this.delegating;
  }

  modes = $derived.by<ThreadModes | null>(() => {
    const standing = this.feed.session.modes;
    const intended = this.intended;
    return standing === null || intended === null ? standing : { ...standing, active: intended };
  });

  get terminalRefusal(): string | null {
    return this.refused;
  }

  private get thread(): WireThread | null {
    return this.feed.session.thread;
  }

  get notes(): readonly string[] {
    const authority = this.thread?.authority;
    const inherited = authority !== undefined && authority.bypassFrom !== null && authority.bypassFrom !== this.feed.threadId;
    return inherited ? ['Inherited from the thread that spawned this one.'] : [];
  }

  delegation = $derived.by<DelegationReading>(() => {
    const threadId = this.feed.threadId;
    const answered = this.thread?.delegation ?? this.switched;
    if (answered === null) return { own: null, allowed: null, origin: null, depth: null };
    const { own, allowed, setAt } = answered;
    const origin = setAt === null ? 'the machine switch' : setAt === threadId ? 'this thread' : 'the thread that leads this team';
    return { own, allowed, origin, depth: this.thread?.spawnDepth ?? null };
  });

  get approving(): ApprovingReading | null {
    return this.thread?.approving ?? null;
  }

  get modeActions(): readonly ModeAction[] {
    const modes = this.modes;
    const strictness = (rung: string) => modes?.declared.find((mode) => mode.id === rung)?.strictness;
    const reach = strictness(modes?.active ?? '');
    const asked = this.threads.askedActions.key(this.projectId).data;
    if (reach === undefined || asked === undefined) return [];
    const asks = (rung: string) => (strictness(rung) ?? Number.POSITIVE_INFINITY) <= reach;
    return asked.flatMap((action) => [
      ...(asks(action.asksFrom) ? [{ id: action.id, label: action.id, description: action.meaning }] : []),
      ...action.conditions
        .filter((one) => asks(one.asksFrom))
        .map((one) => ({ id: one.id, label: one.id, description: `${one.label} (${action.id})` })),
    ]);
  }

  setApprover(pick: ApproverPick): Effect.Effect<void, ThreadRefused> {
    return this.shaped(
      Effect.tryPromise({
        try: () =>
          this.threads.setApprover.run({ id: this.feed.threadId, projectId: this.projectId, approver: pick }, { throwOnError: true }),
        catch: refusedBy,
      }).pipe(Effect.asVoid),
    );
  }

  setApproves(approves: readonly string[] | null): Effect.Effect<void, ThreadRefused> {
    return this.shaped(
      Effect.tryPromise({
        try: () => this.threads.setApproves.run({ id: this.feed.threadId, projectId: this.projectId, approves }, { throwOnError: true }),
        catch: refusedBy,
      }).pipe(Effect.asVoid),
    );
  }

  private shaped<A>(write: Effect.Effect<A, ThreadRefused>): Effect.Effect<A, ThreadRefused> {
    return this.effects.guard(this.feed.shaping.shape(this.feed.threadId, write));
  }

  chooseMode(id: string): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const modes = this.modes;
      if (modes === null || !modes.declared.some((mode) => mode.id === id)) {
        return Effect.fail(new ThreadRefused({ message: `This thread declares no mode "${id}".` }));
      }
      if (id === modes.active) return Effect.void;
      return this.effects.guard(this.offer(id));
    });
  }

  setDelegation(pick: DelegationPick): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      this.delegating = true;
      const own = DELEGATION_OWN[pick];
      return this.shaped(
        Effect.tryPromise({
          try: () =>
            this.threads.setDelegation.run({ id: this.feed.threadId, projectId: this.projectId, delegation: own }, { throwOnError: true }),
          catch: refusedBy,
        }).pipe(
          Effect.map((answered) => {
            if (answered !== undefined) this.switched = answered;
          }),
          Effect.ensuring(
            Effect.sync(() => {
              this.delegating = false;
            }),
          ),
        ),
      );
    });
  }

  promoteDelegation(): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const { own } = this.delegation;
      if (own === null) return Effect.void;
      this.delegating = true;
      return this.effects
        .guard(
          Effect.tryPromise({
            try: () =>
              this.settings.write.run(
                { projectId: this.projectId, scope: 'user', key: delegationKey.id, value: own },
                { throwOnError: true },
              ),
            catch: refusedBy,
          }),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.delegating = false;
            }),
          ),
          Effect.andThen(this.setDelegation('inherit')),
        );
    });
  }

  private offer = Effect.fnUntraced(function* (this: ThreadAuthority, mode: string): Effect.fn.Return<void, ThreadRefused> {
    const done = yield* Deferred.make<void, ThreadRefused>();
    const shaped = this.feed.shaping.hold(this.feed.threadId);
    this.intended = mode;
    this.waiting.add(done);
    this.shaping.add(shaped);
    this.drained();
    yield* Queue.offer(this.intents, { mode, done, shaped });
    return yield* Deferred.await(done);
  });

  private drained(): void {
    if (this.draining) return;
    this.draining = true;
    void this.effects.run(this.drain());
  }

  private settle(done: Deferred.Deferred<void, ThreadRefused>, exit: Exit.Exit<void, ThreadRefused>): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      this.waiting.delete(done);
      return Deferred.done(done, exit);
    });
  }

  private drain = Effect.fnUntraced(
    function* (this: ThreadAuthority): Effect.fn.Return<void> {
      while (true) {
        const batch = yield* Queue.takeAll(this.intents);
        const latest = batch[batch.length - 1];
        for (const superseded of batch.slice(0, -1)) yield* this.settle(superseded.done, Exit.void);
        const exit = yield* Effect.exit(this.move(latest.mode));
        for (const intent of batch) {
          this.shaping.delete(intent.shaped);
          intent.shaped();
        }
        if (Queue.sizeUnsafe(this.intents) === 0) this.intended = null;
        yield* this.settle(latest.done, exit);
      }
    },
    Effect.ensuring(
      Effect.suspend(() => {
        this.draining = false;
        for (const shaped of this.shaping) shaped();
        this.shaping.clear();
        return Effect.forEach([...this.waiting], (done) => Deferred.interrupt(done), { discard: true });
      }),
    ),
  );

  private move(mode: string): Effect.Effect<void, ThreadRefused> {
    const terminal = this.thread !== null && hasScreen(this.thread);
    return this.live
      .attempt((client) => client['thread.authority']({ projectId: this.projectId, threadId: this.feed.threadId, params: { mode } }))
      .pipe(
        Effect.mapError(refusedCall),
        Effect.matchEffect({
          onFailure: (refusal) => {
            if (!terminal) return Effect.fail(refusal);
            this.refused = refusal.message;
            return Effect.void;
          },
          onSuccess: (payload) =>
            Effect.sync(() => {
              if (terminal) this.refused = null;
              this.feed.session.revise(payload.snapshot.thread, declared(payload.snapshot).modes);
            }),
        }),
      );
  }
}
