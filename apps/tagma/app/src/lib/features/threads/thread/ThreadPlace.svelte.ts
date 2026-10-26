import { productPayload } from '@runlith/chat-ui/entries';
import { Service } from '@runlith/layer/key';
import { type RecordedPlace, Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { worktreeMoveId } from '../worktrees/productRecords.js';
import type { WorktreeMove } from '../worktrees/worktreeMove.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';

export class ThreadPlace extends Service<ThreadPlace>()('ThreadPlace', { tier: 'thread' }) {
  static *make() {
    return new ThreadPlace(yield* ThreadFeed, yield* Worktrees);
  }

  constructor(
    private readonly feed: ThreadFeed,
    private readonly places: Worktrees,
  ) {
    super();
  }

  recorded = $derived.by<RecordedPlace | null>(() => this.feed.session.thread?.place ?? null);

  standing = $derived.by(() => this.places.standingOf(this.feed.threadId, this.recorded));

  moveInFlight = $derived.by<WorktreeMove | null>(() => {
    const entry = this.feed.session.fold.index
      .of('product')
      .findLast((candidate) => productPayload(worktreeMoveId, candidate) !== undefined);
    const move = entry === undefined ? null : (productPayload(worktreeMoveId, entry) ?? null);
    return move?.status === 'pending' ? move : null;
  });
}
