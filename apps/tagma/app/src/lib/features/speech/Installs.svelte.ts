import type { InstallEvent, InstallProgress } from '@tagma/server/speech/contract/wire/feeds';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { SpeechRepo } from './Repo.js';

export class Installs extends Service<Installs>()('SpeechInstalls', { tier: 'app' }) {
  static *make() {
    return new Installs(yield* Live, yield* SpeechRepo, yield* Scope, yield* Failure);
  }

  standing = $state.raw<Readonly<Record<string, InstallProgress>>>({});

  constructor(
    live: LiveConnection,
    private readonly speech: SpeechRepo,
    scope: Scope,
    failure: Failure,
  ) {
    super();
    const held = live.hold(
      (client) => client['speech.install.subscribe']({}),
      (progress) => this.take(progress),
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  private take(event: InstallEvent): void {
    if (event.kind === 'snapshot') {
      this.standing = Object.fromEntries(event.installs.map((install) => [install.model, install]));
      if (this.speech.status.data !== undefined) void this.speech.status.refresh();
      return;
    }
    if (event.kind === 'removed') {
      const { [event.model]: _, ...others } = this.standing;
      this.standing = others;
      return;
    }
    const progress: InstallProgress = event;
    const { [progress.model]: _, ...others } = this.standing;
    const finished = progress.failure === null && progress.received >= progress.total;
    this.standing = finished ? others : { ...others, [progress.model]: progress };
    if (finished && this.speech.status.data !== undefined) void this.speech.status.refresh();
  }
}
