import type { Capture, CapturesEvent } from '@tagma/server/speech/contract/wire/feeds';
import { SvelteSet } from 'svelte/reactivity';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

const keyOf = (capture: { readonly kind: string; readonly id: string }): string => JSON.stringify([capture.kind, capture.id]);

export class Captures extends Service<Captures>()('SpeechCaptures', { tier: 'app' }) {
  static *make() {
    return new Captures(yield* Live, yield* Door, yield* Notices, yield* Scope, yield* Failure);
  }

  open = $state.raw<readonly Capture[]>([]);
  stopping = $state(false);
  private readonly claimed = new SvelteSet<string>();

  constructor(
    live: LiveConnection,
    private readonly door: Door,
    private readonly notices: Notices,
    scope: Scope,
    failure: Failure,
  ) {
    super();
    const held = live.hold(
      (client) => client['speech.captures.subscribe']({}),
      (event) => this.take(event),
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  get unclaimed(): readonly Capture[] {
    return this.open.filter((capture) => !this.claimed.has(keyOf(capture)));
  }

  claim(capture: Capture): () => void {
    const key = keyOf(capture);
    this.claimed.add(key);
    return () => this.claimed.delete(key);
  }

  async stop(which: readonly Capture[]): Promise<void> {
    this.stopping = true;
    try {
      await Promise.all(which.map((capture) => this.end(capture)));
    } finally {
      this.stopping = false;
    }
  }

  private async end(capture: Capture): Promise<void> {
    try {
      await this.door.perform('stop_capture', { kind: capture.kind, id: capture.id }, {});
    } catch (error) {
      this.notices.refusal(error);
    }
  }

  private take(event: CapturesEvent): void {
    switch (event.kind) {
      case 'snapshot':
        this.open = event.captures;
        return;
      case 'opened': {
        const key = keyOf(event.capture);
        this.open = [...this.open.filter((capture) => keyOf(capture) !== key), event.capture];
        return;
      }
      case 'ended': {
        const key = keyOf(event.capture);
        this.open = this.open.filter((capture) => keyOf(capture) !== key);
        return;
      }
    }
  }
}
