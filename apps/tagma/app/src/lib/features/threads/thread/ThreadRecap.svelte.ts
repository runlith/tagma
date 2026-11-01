import { Effect } from 'effect';
import { Service } from '@runlith/layer/key';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { ThreadsRepo } from '../Repo.js';
import { ThreadEffects } from './ThreadEffects.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';
import { ThreadRefused } from './ThreadRefused.js';

export class ThreadRecap extends Service<ThreadRecap>()('ThreadRecap', { tier: 'thread' }) {
  static *make() {
    return new ThreadRecap(yield* ThreadFeed, yield* ThreadEffects, yield* ThreadsRepo, (yield* ProjectRung.Current).projectId);
  }

  private writing = $state(false);

  constructor(
    private readonly feed: ThreadFeed,
    private readonly effects: ThreadEffects,
    private readonly threads: ThreadsRepo,
    private readonly projectId: number,
  ) {
    super();
  }

  get recap() {
    const recap = this.feed.chatThread?.recap ?? null;
    return recap === null || recap.status === 'void' ? null : recap;
  }

  get attempt() {
    return this.feed.chatThread?.recapAttempt ?? null;
  }

  get busy(): boolean {
    return this.writing || this.feed.session.thread?.recapAttempt?.state === 'writing';
  }

  write(): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      if (this.busy) return Effect.void;
      this.writing = true;
      return this.effects.guard(
        Effect.tryPromise({
          try: () => this.threads.generateRecap.run({ id: this.feed.threadId, projectId: this.projectId }, { throwOnError: true }),
          catch: refusalOf,
        }).pipe(
          Effect.asVoid,
          Effect.catchIf(
            (refusal) => refusal.gate,
            () => Effect.void,
          ),
          Effect.mapError((refusal) => new ThreadRefused({ message: [refusal.reason, ...refusal.unblock].join(' ') })),
          Effect.ensuring(
            Effect.sync(() => {
              this.writing = false;
            }),
          ),
        ),
      );
    });
  }
}
