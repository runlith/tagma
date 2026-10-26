import type { Holding } from '@tagma/server/change-record/contract/wire/holdings';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { type HoldingsHead, HoldingsReading } from '$lib/features/worktrees/HoldingsReading.svelte.js';
import { Checkout } from './Selection.svelte.js';

export class Holdings extends Service<Holdings>()('Holdings', { tier: 'graph', eager: true }) {
  static *make() {
    return new Holdings(yield* Live, yield* GraphRung.Current, yield* Checkout, yield* Scope);
  }

  readonly reading: HoldingsReading;

  constructor(
    live: LiveConnection,
    aim: GraphAim,
    private readonly checkout: Checkout,
    scope: Scope,
  ) {
    super();
    const reading = new HoldingsReading(live, aim.projectId);
    this.reading = reading;
    const stop = $effect.root(() => {
      $effect(() => {
        const named = checkout.reading;
        untrack(() => reading.aim(named));
      });
    });
    scope.defer(() => {
      stop();
      reading.close();
    });
  }

  lagging = $derived.by(() => this.reading.behind(this.checkout.row));

  get view(): HoldingsHead | null {
    return this.reading.view;
  }

  get unread(): string | null {
    return this.reading.unread;
  }

  of(path: string): Holding | undefined {
    return this.reading.of(path);
  }
}
