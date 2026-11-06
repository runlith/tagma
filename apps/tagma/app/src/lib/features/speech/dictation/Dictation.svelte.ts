import type { Heard, TrackPlace } from '@tagma/server/speech/contract/wire/listening';
import type { Words } from '@tagma/server/platform/contract/wire/refusal';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Stream } from 'effect';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { Act } from '$lib/wire/told.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection, type LiveFailure } from '$lib/wire/Live.js';
import { Refusal, refusalOf } from '$lib/wire/refusal.js';
import { SoundChannel } from '$lib/wire/SoundChannel.js';
import { levelDb, levelFill, SILENCE_DB } from '../check.js';
import { SpeechRepo } from '../Repo.js';
import { microphoneMissing, Sender } from './Sender.js';
import { Take, type Ending, type Settled } from './take.js';
import type { Target } from './target.js';

export const HOLD_MS = 300;
export const FINISH_MS = 2_000;
export const QUIET_MS = 3_000;
const TICK_MS = 250;
const LEVEL_STEPS = 8;
const INSERTED_UNSENT = 'What was heard was inserted and not sent.';

export type Phase = 'idle' | 'recording' | 'finishing';

type Failure = {
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly words?: Words;
  readonly act?: Act;
};
type Queued = { readonly target: Target; readonly pressedAt: number; readonly latched: boolean };

export class Dictation extends Service<Dictation>()('Dictation', { tier: 'app' }) {
  static *make() {
    return new Dictation(yield* Live, yield* Door, yield* SoundChannel, yield* Notices, yield* SpeechRepo, yield* Scope);
  }

  phase = $state<Phase>('idle');
  target = $state.raw<Target | null>(null);
  latched = $state(false);
  startedAt = $state(0);
  now = $state(0);
  level = $state(0);
  quietSince = $state<number | null>(null);
  stable = $state('');
  guess = $state('');

  private take: Take | null = null;
  private held: { unsubscribe: () => void } | null = null;
  private sender: Sender | null = null;
  private admitted = false;
  private requested = false;
  private id = '';
  private pressedAt = 0;
  private send = false;
  private next: Queued | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly live: LiveConnection,
    private readonly door: Door,
    private readonly channel: SoundChannel,
    private readonly notices: Notices,
    private readonly speech: SpeechRepo,
    scope: Scope,
  ) {
    super();
    scope.defer(() => this.cancel());
  }

  get hushed(): boolean {
    return this.phase === 'recording' && this.quietSince !== null && this.now - this.quietSince >= QUIET_MS;
  }

  press(target: Target, send: boolean): void {
    if (this.phase === 'idle') this.begin(target, Date.now(), false);
    else if (this.phase === 'recording' && this.latched) this.finish(send);
    else if (this.phase === 'finishing') this.next = { target, pressedAt: Date.now(), latched: false };
  }

  lift(send: boolean): void {
    if (this.phase === 'finishing') {
      const next = this.next;
      if (next === null || next.latched) return;
      if (Date.now() - next.pressedAt < HOLD_MS) this.next = { ...next, latched: true };
      else {
        this.next = null;
        this.tell('dictation-not-started', 'Recording did not start: the previous dictation was still finishing.', [
          'Press again once it has finished.',
        ]);
      }
      return;
    }
    if (this.phase !== 'recording' || this.latched) return;
    if (Date.now() - this.pressedAt < HOLD_MS) this.latched = true;
    else this.finish(send);
  }

  toggle(target: Target, send: boolean): void {
    if (this.phase === 'idle') this.begin(target, Date.now(), true);
    else if (this.phase === 'recording') this.finish(send);
    else this.next = { target, pressedAt: Date.now(), latched: true };
  }

  cancel(): void {
    this.next = null;
    const take = this.take;
    if (take === null) return;
    this.stop();
    if (!take.cancel()) this.tell('dictation-edited', 'The dictated text was edited by hand, so Esc removed nothing.', []);
  }

  drop(target: Target, reason: string): void {
    if (this.next?.target === target) this.next = null;
    if (this.target !== target || this.take === null) return;
    const take = this.take;
    this.stop();
    take.drop();
    this.tell('dictation-stopped', reason, []);
  }

  private begin(target: Target, pressedAt: number, latched: boolean): void {
    const take = new Take(target);
    if (!take.open()) {
      this.tell('no-dictation-target', 'The field to dictate into is not open.', [
        'Click into an agent field or a terminal, then press again.',
      ]);
      return;
    }
    this.take = take;
    this.id = crypto.randomUUID();
    this.target = target;
    this.phase = 'recording';
    this.pressedAt = pressedAt;
    this.latched = latched;
    this.send = false;
    this.startedAt = this.now = Date.now();
    this.quietSince = this.startedAt;
    this.ticker = setInterval(() => (this.now = Date.now()), TICK_MS);
    void this.open(this.id);
  }

  private async open(id: string): Promise<void> {
    const status = this.speech.status.watch() ?? (await this.speech.status.load());
    if (this.id !== id) return;
    if (status === undefined) {
      return this.fail(id, {
        code: 'speech-status-unread',
        reason: 'Dictation could not tell where to record: the speech status did not load.',
        unblock: ['Try again.'],
      });
    }
    if (status.mic === 'server') return this.subscribe(id, 'server');
    const missing = microphoneMissing();
    if (missing !== null) return this.fail(id, missing);
    const sender = new Sender(this.channel, id, (failure) => this.fail(id, failure));
    this.sender = sender;
    if (!(await sender.start()) || this.id !== id) return;
    this.subscribe(id, 'caller');
    sender.connect();
  }

  private subscribe(id: string, at: TrackPlace): void {
    let opened = false;
    this.held = this.live.hold<Heard | null>(
      (client) => {
        if (opened) {
          queueMicrotask(() =>
            this.fail(id, { code: 'interrupted', reason: 'The connection was reopened, which ends a dictation.', unblock: [] }),
          );
          return Stream.never;
        }
        opened = true;
        return client['speech.recognize']({ id, tracks: [{ source: 'mic', at }], purpose: 'dictation' }).pipe(
          Stream.concat(Stream.succeed(null)),
        );
      },
      (heard) => this.hear(id, heard),
      (failure) => this.fail(id, failed(failure)),
    );
  }

  private hear(id: string, heard: Heard | null): void {
    if (this.id !== id || this.take === null) return;
    if (heard === null) return void this.settle('end');
    if (heard.kind === 'level') return this.sound(heard.peak);
    if (heard.kind === 'state' && !this.admitted) {
      this.admitted = true;
      if (this.phase === 'finishing') this.request(id);
      return;
    }
    if (heard.kind === 'track' && heard.phase === 'failed') {
      return this.fail(id, { code: 'recognizer-failed', reason: heard.reason ?? 'The recognizer failed.', unblock: [] });
    }
    this.take.hear(heard);
    if (heard.kind !== 'utterance') return;
    this.stable = this.take.stable;
    this.guess = this.take.guess;
  }

  private sound(peak: number): void {
    const level = Math.round(levelFill(peak) * LEVEL_STEPS) / LEVEL_STEPS;
    if (level !== this.level) this.level = level;
    const loud = levelDb(peak) > SILENCE_DB;
    if (loud && this.quietSince !== null) this.quietSince = null;
    else if (!loud && this.quietSince === null) this.quietSince = Date.now();
  }

  private finish(send: boolean): void {
    this.phase = 'finishing';
    this.send = send;
    if (this.admitted) this.request(this.id);
  }

  private request(id: string): void {
    if (this.requested) return;
    this.requested = true;
    this.sender?.end();
    this.deadline = setTimeout(() => {
      if (this.id === id) void this.settle('deadline');
    }, FINISH_MS);
    this.door.perform('finish_recognition', { id }, {}).then(
      () => undefined,
      (error: unknown) => {
        const refusal = refusalOf(error);
        this.fail(id, { code: refusal.code, reason: refusal.reason, unblock: refusal.unblock, words: refusal.words, act: refusal.act });
      },
    );
  }

  private fail(id: string, failure: Failure): void {
    if (this.id !== id) return;
    void this.settle('failed', failure);
  }

  private async settle(ending: Ending, failure?: Failure): Promise<void> {
    const take = this.take;
    if (take === null) return;
    const unsure = this.sender !== null && (!this.sender.whole || (ending === 'deadline' && !this.sender.clean));
    const send = this.send && !unsure;
    const next = this.next;
    this.next = null;
    this.stop();
    const settled = await take.settle(ending, send);
    if (settled !== null) this.report(settled, failure);
    if (settled !== null && unsure && this.send && failure === undefined && settled.lost.length === 0) {
      this.tell(
        'dictation-unconfirmed',
        'The end of the sound did not reach the server in time.',
        [],
        undefined,
        undefined,
        INSERTED_UNSENT,
      );
    }
    if (next !== null && this.phase === 'idle') this.begin(next.target, next.pressedAt, next.latched);
  }

  private report(settled: Settled, failure: Failure | undefined): void {
    const unplaced = settled.unplaced;
    if (unplaced !== '') {
      this.tell(
        'dictation-not-placed',
        `Where the dictation was typing changed or closed before it finished, so these words had nowhere to go: “${unplaced}”`,
        [],
        { text: 'Some dictated words were not placed.' },
        { label: 'Copy', run: () => void navigator.clipboard.writeText(unplaced) },
      );
    }
    if (failure !== undefined) {
      const kept = unplaced === '' && settled.text.trim() !== '' ? 'What was heard stays; nothing was sent.' : undefined;
      this.tell(
        failure.code,
        failure.reason,
        failure.unblock,
        { ...failure.words, text: failure.words?.text ?? [failure.reason, ...failure.unblock].join(' ') },
        failure.act,
        kept,
      );
    } else if (settled.lost.length > 0) {
      this.tell('dictation-unconfirmed', settled.lost.map(sentence).join(' '), [], undefined, undefined, INSERTED_UNSENT);
    }
  }

  private tell(
    code: string,
    reason: string,
    unblock: readonly string[],
    words: Words = { text: [reason, ...unblock].join(' ') },
    act?: Act,
    note?: string,
  ): void {
    this.notices.refusal(new Refusal({ gate: false, code, reason, unblock, words, note, act }));
  }

  private stop(): void {
    this.held?.unsubscribe();
    this.held = null;
    this.sender?.stop();
    this.sender = null;
    this.admitted = false;
    this.requested = false;
    if (this.ticker !== null) clearInterval(this.ticker);
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.ticker = null;
    this.deadline = null;
    this.take = null;
    this.id = '';
    this.target = null;
    this.phase = 'idle';
    this.latched = false;
    this.level = 0;
    this.quietSince = null;
    this.stable = '';
    this.guess = '';
  }
}

function sentence(text: string): string {
  const said = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

function failed(failure: LiveFailure): Failure {
  return failure.kind === 'subscription'
    ? { code: failure.code ?? 'dictation-failed', reason: failure.message, unblock: failure.unblock ?? [], words: failure.words }
    : { code: 'transport', reason: failure.message, unblock: [] };
}
