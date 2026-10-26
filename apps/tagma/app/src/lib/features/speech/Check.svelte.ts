import type { RecognizerAsk } from '@tagma/server/speech/contract/wire/listening';
import { Scope } from '@runlith/layer/Scope';
import { Stream } from 'effect';
import { Service } from '@runlith/layer/key';
import type { Told } from '$lib/wire/told.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { Refusal } from '$lib/wire/refusal.js';
import { apply, emptyRun, over, type Run, type Source } from './check.js';

const TICK_MS = 500;

export class Check extends Service<Check>()('SpeechCheck', { tier: 'app' }) {
  static *make() {
    return new Check(yield* Live, yield* Scope);
  }

  run = $state.raw<Run>(emptyRun);
  asked = $state.raw<readonly Source[]>([]);
  running = $state(false);
  startedAt = $state(0);
  now = $state(0);
  stopped = $state.raw<Told | null>(null);

  private held: { unsubscribe: () => void } | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly live: LiveConnection,
    scope: Scope,
  ) {
    super();
    scope.defer(() => this.stop());
  }

  start(asked: readonly Source[], recognizer?: RecognizerAsk): void {
    this.stop();
    this.run = emptyRun;
    this.asked = asked;
    this.stopped = null;
    this.startedAt = this.now = Date.now();
    this.running = true;
    this.ticker = setInterval(() => (this.now = Date.now()), TICK_MS);
    let opened = false;
    this.held = this.live.hold(
      (client) => {
        if (opened) {
          this.stopped = { text: 'The connection to Tagma was interrupted, which ends a check. Start the check again.', details: [] };
          queueMicrotask(() => this.stop());
          return Stream.never;
        }
        opened = true;
        return client['speech.recognize']({
          id: crypto.randomUUID(),
          tracks: asked.map((source) => ({ source, echoCancel: false })),
          recognizer,
        });
      },
      (heard) => {
        this.run = apply(this.run, heard, Date.now());
        if (over(this.run, asked.length)) this.stop();
      },
      (failure) => {
        this.stopped =
          failure.kind === 'subscription'
            ? new Refusal({
                gate: false,
                code: failure.code ?? 'failed',
                reason: failure.message,
                unblock: failure.unblock ?? [],
                words: failure.words,
              }).told
            : { text: 'The connection to Tagma was lost, which ends a check. Start the check again.', details: [failure.message] };
        this.stop();
      },
    );
  }

  stop(): void {
    this.held?.unsubscribe();
    this.held = null;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    this.running = false;
  }
}
