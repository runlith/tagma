import { Effect } from 'effect';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import { Service } from '@runlith/layer/key';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { instructionsMessage, sourcesMessage } from '../instructionsWords.js';
import { ThreadsRepo } from '../Repo.js';
import { ThreadEffects } from './ThreadEffects.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';
import { answered, type ThreadRefused } from './ThreadRefused.js';

const STATUS = {
  updated: 'Instructions updated — this thread runs them from its next turn.',
  current: 'Instructions are already current.',
} as const;

export class ThreadInstructions extends Service<ThreadInstructions>()('ThreadInstructions', { tier: 'thread' }) {
  static *make() {
    return new ThreadInstructions(yield* ThreadFeed, yield* ThreadEffects, yield* ThreadsRepo, (yield* ProjectRung.Current).projectId);
  }

  constructor(
    private readonly feed: ThreadFeed,
    private readonly effects: ThreadEffects,
    private readonly threads: ThreadsRepo,
    private readonly projectId: number,
  ) {
    super();
  }

  refresh(): Effect.Effect<ChatNotice, ThreadRefused> {
    return this.effects.guard(
      answered(() =>
        this.threads.refreshInstructions.run({ id: this.feed.threadId, projectId: this.projectId }, { throwOnError: true }),
      ).pipe(
        Effect.map((refreshed): ChatNotice => ({
          tone: refreshed.sources.rejected.length > 0 ? 'error' : 'success',
          message: `${STATUS[refreshed.status]} ${sourcesMessage(refreshed.sources)} ${instructionsMessage(refreshed.instructions)}`,
        })),
      ),
    );
  }
}
