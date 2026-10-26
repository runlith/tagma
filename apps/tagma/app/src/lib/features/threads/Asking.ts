import { Service } from '@runlith/layer/key';
import { DEFAULT_THREAD_TYPE } from '@tagma/server/threads/contract/wire/settings';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ShellOps, shellActs, type ShellActs } from '$lib/features/workspace/ShellOps.js';
import { DraftShelf } from './native/DraftShelf.svelte.js';
import { ThreadsRepo } from './Repo.js';
import { ThreadChats } from './ThreadChats.js';

export type AskPlace = { readonly projectId: number; readonly worktree?: string | undefined };

export class Asking extends Service<Asking>()('Asking', { tier: 'app' }) {
  static *make() {
    const notices = yield* Notices;
    return new Asking(yield* ThreadsRepo, yield* ThreadChats, yield* DraftShelf, shellActs(yield* ShellOps, notices), notices);
  }

  constructor(
    private readonly threads: ReturnType<typeof ThreadsRepo.use>,
    private readonly chats: ThreadChats,
    private readonly shelf: DraftShelf,
    private readonly shell: ShellActs,
    private readonly notices: Notices,
  ) {
    super();
  }

  ask(place: AskPlace, text: string): Promise<void> {
    return this.begin(place, async (threadId) => {
      const said = await this.chats.say(place.projectId, threadId, { text });
      if (said.status === 'failed') this.notices.error('Ask Tagma', said.message);
    });
  }

  draft(place: AskPlace, text: string): Promise<void> {
    return this.begin(place, (threadId) => {
      const key = `thread:${threadId}`;
      this.shelf.at(key).text = text;
      this.shelf.keep(key);
    });
  }

  private async begin(place: AskPlace, then: (threadId: string) => void | Promise<void>): Promise<void> {
    try {
      const created = await this.threads.create.run(
        { projectId: place.projectId, payload: { type: DEFAULT_THREAD_TYPE, worktree: place.worktree } },
        { throwOnError: true },
      );
      if (created === undefined) return;
      const threadId = created.snapshot.thread.id;
      await then(threadId);
      void this.shell.openThread({ projectId: place.projectId, threadId }, 'beside');
    } catch (error) {
      this.notices.refusal(error);
    }
  }
}
