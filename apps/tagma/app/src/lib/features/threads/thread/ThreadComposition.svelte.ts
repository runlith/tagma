import { Effect } from 'effect';
import type { ThreadCompositionReading } from '@tagma/server/threads/contract/wire/snapshot';
import { Service } from '@runlith/layer/key';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ThreadsRepo } from '../Repo.js';
import { ThreadEffects } from './ThreadEffects.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';
import { refusedBy } from './ThreadRefused.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;

export class ThreadComposition extends Service<ThreadComposition>()('ThreadComposition', { tier: 'thread' }) {
  static *make() {
    return new ThreadComposition(yield* ThreadFeed, yield* ThreadEffects, yield* ThreadsRepo, (yield* ProjectRung.Current).projectId);
  }

  reading = $state.raw<ThreadCompositionReading | null>(null);
  failure = $state<string | null>(null);

  constructor(
    private readonly feed: ThreadFeed,
    private readonly effects: ThreadEffects,
    private readonly threads: Threads,
    private readonly projectId: number,
  ) {
    super();
  }

  read(): Promise<void> {
    return this.effects.run(this.load()).then(() => undefined);
  }

  private load(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.failure = null;
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => this.threads.composition.run({ id: this.feed.threadId, projectId: this.projectId }, { throwOnError: true }),
          catch: refusedBy,
        }),
      ),
      Effect.matchEffect({
        onSuccess: (reading) =>
          Effect.sync(() => {
            if (reading !== undefined) this.reading = reading;
          }),
        onFailure: (refusal) =>
          Effect.sync(() => {
            this.failure = refusal.message;
          }),
      }),
    );
  }
}
