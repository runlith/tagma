import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { SpeechRepo } from './Repo.js';

export class StatusRefresh extends Service<StatusRefresh>()('SpeechStatusRefresh', { tier: 'app' }) {
  static *make() {
    return new StatusRefresh(yield* Live, yield* SpeechRepo, yield* Scope, yield* Failure);
  }

  constructor(
    live: LiveConnection,
    private readonly speech: SpeechRepo,
    scope: Scope,
    failure: Failure,
  ) {
    super();
    const held = live.hold(
      (client) => client['speech.catalog.subscribe']({}),
      () => this.moved(),
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  private moved(): void {
    const status = this.speech.status;
    if (status.watch() !== undefined || status.watchError() !== undefined || status.watchFetching()) void status.refresh();
  }
}
