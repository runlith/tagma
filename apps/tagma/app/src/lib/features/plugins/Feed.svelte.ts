import type { EntryRow, MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

export class MarketplacesFeed extends Service<MarketplacesFeed>()('MarketplacesFeed', { tier: 'app' }) {
  static *make() {
    return new MarketplacesFeed(yield* Live, yield* Failure);
  }

  marketplaces = $state<readonly MarketplaceRow[]>([]);
  entries = $state<readonly EntryRow[]>([]);
  known = $state(false);

  private holders = 0;
  private held: { unsubscribe(): void } | null = null;

  constructor(
    private readonly live: LiveConnection,
    private readonly failure: Failure,
  ) {
    super();
  }

  hold(): () => void {
    if (this.holders++ === 0) {
      this.held = this.live.hold(
        (client) => client['marketplaces.subscribe']({}),
        (frame) => {
          this.marketplaces = frame.marketplaces;
          this.entries = frame.entries;
          this.known = true;
        },
        (reason) => {
          if (reason.kind === 'subscription') this.failure.report(new Error(reason.message));
        },
      );
    }
    return () => {
      if (--this.holders > 0) return;
      this.held?.unsubscribe();
      this.held = null;
    };
  }
}
