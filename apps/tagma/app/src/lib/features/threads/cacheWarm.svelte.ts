import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import type { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { warmthFilled } from './warmthWords.js';

export class CacheWarm {
  readonly filled: boolean;

  constructor(warmth: () => ThreadCacheWarmth | null, clock: WallClock) {
    const expiry = $derived.by(() => {
      const read = warmth();
      return read?.basis === 'promise' && read.expiresAt !== null ? Date.parse(read.expiresAt) : null;
    });
    $effect(() => (expiry === null ? undefined : clock.watchDeadline(expiry)));
    this.filled = $derived(warmthFilled(warmth(), () => clock.now));
  }
}
