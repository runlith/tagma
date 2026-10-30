import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { NO_WORK, observe, type WorkInput, type WorkMemory, type WorkShown } from './workLine.js';

export class WorkLines extends Service<WorkLines>()('WorkLines', { tier: 'tile' }) {
  static *make() {
    return new WorkLines(yield* WallClock);
  }

  private readonly memories = new SvelteMap<string, WorkMemory>();
  private readonly inputs = new Map<string, WorkInput>();
  private following = $state(0);

  constructor(private readonly clock: WallClock) {
    super();
    $effect(() => {
      if (this.following === 0) return;
      return this.clock.watch();
    });
    $effect(() => {
      void this.clock.now;
      untrack(() => this.reobserve());
    });
  }

  follow(threadId: string, input: WorkInput | null): void {
    if (input === null) {
      this.release(threadId);
      return;
    }
    this.inputs.set(threadId, input);
    this.following = this.inputs.size;
    this.see(threadId, input);
  }

  release(threadId: string): void {
    this.inputs.delete(threadId);
    this.following = this.inputs.size;
    this.memories.delete(threadId);
  }

  shown(threadId: string): WorkShown | null {
    return this.memories.get(threadId)?.shown ?? null;
  }

  private reobserve(): void {
    for (const [threadId, input] of this.inputs) this.see(threadId, input);
  }

  private see(threadId: string, input: WorkInput): void {
    this.memories.set(threadId, observe(this.memories.get(threadId) ?? NO_WORK, input, Date.now()));
  }
}
