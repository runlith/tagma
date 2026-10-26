import type { FaultsPage } from '@tagma/server/activity/contract/wire/faults';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

const SHOWN = 50;

export class ServerFaults extends Service<ServerFaults>()('ServerFaults', { tier: 'app' }) {
  static *make() {
    return new ServerFaults(yield* Live, yield* Door, yield* Notices, yield* Scope);
  }

  page = $state.raw<FaultsPage | null>(null);
  clearing = $state(false);

  constructor(
    live: LiveConnection,
    private readonly door: Door,
    private readonly notices: Notices,
    scope: Scope,
  ) {
    super();
    const feed = live.hold(
      (client) => client['faults.subscribe']({ limit: SHOWN }),
      (frame) => {
        if (frame.type === 'page') this.page = frame;
        else notices.fault('Server errors unreadable', frame.reason);
      },
      (failure) => {
        if (failure.kind === 'subscription') notices.fault('Server errors unreadable', failure.message);
      },
    );
    scope.defer(() => feed.unsubscribe());
  }

  async clear(): Promise<void> {
    this.notices.clearFaults();
    if (this.clearing) return;
    this.clearing = true;
    try {
      await this.door.perform('clear_faults', {}, {});
    } catch (error) {
      this.notices.refusal(error);
    } finally {
      this.clearing = false;
    }
  }
}
