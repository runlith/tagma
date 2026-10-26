import type { Capture, CapturesEvent } from '@tagma/server/speech/contract/wire/feeds';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

const keyOf = (capture: { readonly kind: string; readonly id: string }): string => `${capture.kind}/${capture.id}`;

export class Captures extends Service<Captures>()('SpeechCaptures', { tier: 'app' }) {
  static *make() {
    return new Captures(yield* Live, yield* Door, yield* Notices, yield* Scope, yield* Failure);
  }

  open = $state.raw<readonly Capture[]>([]);
  stopping = $state(false);

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

  async stop(which: readonly Capture[] = this.open): Promise<void> {
    this.stopping = true;
    try {
      await Promise.all(which.map((capture) => this.end(capture)));
    } finally {
      this.stopping = false;
    }
  }

  private async end(capture: Capture): Promise<void> {
    try {
      if (capture.kind === 'recognition') await this.door.perform('finish_recognition', { id: capture.id }, {});
      else {
        const lens = capture.projectId === null ? {} : { project: String(capture.projectId) };
        await this.door.perform('end_listening', { listening: capture.id, mode: 'stop' }, lens);
      }
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
