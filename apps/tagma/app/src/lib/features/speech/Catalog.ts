import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { SpeechRepo } from './Repo.js';

export class Catalog extends Service<Catalog>()('SpeechCatalog', { tier: 'app' }) {
  static *make() {
    return new Catalog(yield* Live, yield* SpeechRepo, yield* Scope, yield* Failure);
  }

  private opened = false;

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
    if (this.opened && this.speech.status.data !== undefined) void this.speech.status.refresh();
    this.opened = true;
  }
}
