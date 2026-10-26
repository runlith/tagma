import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { TextDocument } from '@runlith/code-editor/document';
import type { LineRange } from '@runlith/code-editor/marks';
import { type Door, utf8Bytes } from '$lib/wire/Door.js';
import { refusalOf } from '$lib/wire/refusal.js';
import type { AutoSavePolicy } from './AutoSave.svelte.js';
import { lfText } from './lineDiff.js';

export type WriteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'writing' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'conflict'; readonly ranges: readonly LineRange[] };

export type WriteSource = {
  readonly document: TextDocument | null;
  readonly deleted: boolean;
  readonly path: string;
  resync(): void;
  written(): void;
  rested(): void;
};

export type WritePlace = { readonly projectId: number; readonly rootId: RootId | null };

export type Trigger = 'focus' | 'window' | 'hide' | 'command';

const IDLE: WriteState = { kind: 'idle' };
const PENDING: WriteState = { kind: 'pending' };
const WRITING: WriteState = { kind: 'writing' };

const CATCH_UP_MS = 3000;

const ANSWER_MS = 20_000;

const IMMEDIATE_RETRIES = 3;

const REMEMBERED = 32;

type Inflight = {
  readonly id: string;
  readonly snapshot: ReturnType<TextDocument['pending']>;
  readonly text: string | null;
  settled: boolean;
};

type Saved =
  | { readonly status: 'ok'; readonly digest: string; readonly unconfirmed: string | null }
  | { readonly status: 'moved'; readonly digest: string | null };

type Flushing = { readonly keepalive?: boolean; readonly command?: boolean };

const WRITING_ON: Readonly<Record<Trigger, readonly AutoSavePolicy['mode'][]>> = {
  focus: ['afterDelay', 'onFocusChange'],
  window: ['onWindowChange'],
  hide: ['afterDelay', 'onFocusChange', 'onWindowChange'],
  command: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'],
};

export class Writes {
  state = $state.raw<WriteState>(IDLE);

  unconfirmed = $state<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private catching: ReturnType<typeof setTimeout> | null = null;
  private inflight: Inflight | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private waiting = false;
  private spins = 0;
  private holds = 0;
  private typedSinceGone = false;
  private readonly sent = new Map<string, Inflight>();

  constructor(
    private readonly door: Door,
    private readonly place: WritePlace,
    private readonly source: WriteSource,
    private readonly policy: () => AutoSavePolicy,
  ) {}

  get unwritable(): boolean {
    return this.state.kind === 'refused' || this.state.kind === 'conflict';
  }

  private get conflicting(): boolean {
    return this.state.kind === 'conflict';
  }

  private get dirty(): boolean {
    return this.source.document?.dirty === true;
  }

  private get resurrecting(): boolean {
    return this.source.deleted && !this.typedSinceGone;
  }

  dispose(): void {
    this.clear();
    if (this.catching !== null) clearTimeout(this.catching);
    this.catching = null;
  }

  edited(): void {
    if (this.source.deleted) this.typedSinceGone = true;
    if (this.conflicting || this.running !== null) return;
    if (this.policy().mode === 'afterDelay') {
      this.show(PENDING);
      this.arm(this.policy().delay);
    } else this.clear();
  }

  repolicy(): void {
    if (this.conflicting || this.running !== null) return;
    this.clear();
    if (this.dirty && this.policy().mode === 'afterDelay' && !this.resurrecting) {
      this.show(PENDING);
      this.arm(this.policy().delay);
    } else if (this.state.kind === 'pending' && !this.waiting) this.show(IDLE);
  }

  on(trigger: Trigger, keepalive = false): Promise<void> {
    if (!WRITING_ON[trigger].includes(this.policy().mode)) return Promise.resolve();
    return this.flush({ keepalive, command: trigger === 'command' });
  }

  hold(): () => void {
    this.holds += 1;
    this.clear();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      if (this.holds === 0 && this.dirty && !this.conflicting) this.edited();
    };
  }

  conflict(ranges: readonly LineRange[]): void {
    this.clear();
    this.waiting = false;
    this.state = { kind: 'conflict', ranges };
  }

  resolved(): void {
    if (this.state.kind === 'conflict') this.state = IDLE;
  }

  reset(): void {
    this.clear();
    this.waiting = false;
    this.typedSinceGone = false;
    this.state = IDLE;
  }

  refuse(reason: string): void {
    this.clear();
    if (!this.conflicting) this.state = { kind: 'refused', reason };
  }

  gone(): void {
    this.clear();
    this.waiting = false;
    this.typedSinceGone = false;
    if (this.state.kind === 'pending') this.show(IDLE);
  }

  caughtUp(): void {
    const waited = this.waiting;
    this.waiting = false;
    this.spins = 0;
    if (this.catching !== null) clearTimeout(this.catching);
    this.catching = null;
    if (this.conflicting) return;
    if (this.state.kind === 'refused') {
      this.show(IDLE);
      if (this.dirty) this.edited();
      return;
    }
    if (!waited) return;
    if (this.resurrecting) {
      if (this.state.kind === 'pending') this.show(IDLE);
      return;
    }
    this.arm(0);
  }

  echoed(id: string, digest: string): boolean {
    const mine = this.sent.get(id);
    if (mine === undefined) return false;
    if (!mine.settled) this.settle(mine, digest);
    return true;
  }

  echoedText(text: string, digest: string): boolean {
    const mine = this.inflight;
    if (mine === null || mine.text === null || mine.text !== lfText(text)) return false;
    return this.settle(mine, digest);
  }

  flush(how: Flushing = {}): Promise<void> {
    this.clear();
    if (this.holds > 0 || this.conflicting) return this.running ?? Promise.resolve();
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    if (!this.dirty) {
      if (this.state.kind === 'pending' || this.state.kind === 'refused') this.show(IDLE);
      this.source.rested();
      return Promise.resolve();
    }
    if (this.resurrecting && how.command !== true) return Promise.resolve();
    this.running = this.cycle(how).finally(() => {
      this.running = null;
      this.follow();
    });
    return this.running;
  }

  private show(next: WriteState): void {
    if (this.state !== next) this.state = next;
  }

  private settle(mine: Inflight, digest: string): boolean {
    if (mine.settled) return true;
    mine.settled = true;
    const doc = this.source.document;
    if (doc === null || !doc.settled(mine.snapshot, digest)) {
      this.source.resync();
      return false;
    }
    this.source.written();
    this.typedSinceGone = false;
    return true;
  }

  private arm(delay: number): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private follow(): void {
    if (this.conflicting) return;
    if (this.state.kind === 'idle' || this.state.kind === 'pending') {
      if (this.waiting) return;
      if (this.dirty) {
        if (this.policy().mode === 'afterDelay' && !this.resurrecting) {
          this.show(PENDING);
          this.arm(this.policy().delay);
        } else this.show(IDLE);
        return;
      }
      this.show(IDLE);
      this.source.rested();
    }
  }

  private async cycle(how: Flushing): Promise<void> {
    do {
      this.again = false;
      await this.send(how);
    } while (this.again && this.holds === 0 && !this.conflicting && this.dirty);
  }

  private rest(next: WriteState): void {
    if (!this.conflicting) this.state = next;
  }

  private async send(how: Flushing): Promise<void> {
    const doc = this.source.document;
    if (doc === null) return;
    const snapshot = doc.pending();
    const create = this.source.deleted;
    const id = crypto.randomUUID();
    const mine: Inflight = { id, snapshot, text: create ? lfText(doc.read()) : null, settled: false };
    this.inflight = mine;
    this.sent.set(id, mine);
    if (this.sent.size > REMEMBERED) this.sent.delete(this.sent.keys().next().value as string);
    this.show(WRITING);
    const signal = AbortSignal.timeout(ANSWER_MS);
    let answer: Saved;
    try {
      const body = create ? { base: null, text: doc.read() } : { base: snapshot.digest, edits: [...snapshot.edits] };
      const { rootId } = this.place;
      const call = { project: String(this.place.projectId) };
      const transport = { signal, keepalive: how.keepalive === true };
      if (rootId === null) {
        const saved = await this.door.perform('write_file', { path: this.source.path, write: id, ...body }, call, transport);
        answer = saved.status === 'ok' ? { ...saved, unconfirmed: null } : saved;
      } else {
        answer = await this.door.perform('write_document', { root: rootId, path: this.source.path, write: id, ...body }, call, transport);
      }
    } catch (error) {
      this.inflight = null;
      this.rest({
        kind: 'refused',
        reason: signal.aborted ? 'The server did not answer the save in time.' : refusalOf(error).reason,
      });
      return;
    }
    this.inflight = null;
    if (answer.status === 'ok') {
      this.spins = 0;
      this.settle(mine, answer.digest);
      this.unconfirmed = answer.unconfirmed;
      this.rest(IDLE);
      return;
    }
    this.rest(PENDING);
    const known = this.source.deleted ? null : doc.digest;
    if (known === answer.digest && this.spins < IMMEDIATE_RETRIES) {
      this.spins += 1;
      this.again = !this.conflicting;
      return;
    }
    this.waiting = true;
    this.catching = setTimeout(() => {
      this.catching = null;
      if (this.waiting) this.source.resync();
    }, CATCH_UP_MS);
  }

  payloadBytes(): number {
    const doc = this.source.document;
    if (doc === null) return 0;
    if (this.source.deleted) return utf8Bytes(doc.read()) + 200;
    return doc.pending().edits.reduce((sum, edit) => sum + 40 + edit.lines.reduce((lines, line) => lines + utf8Bytes(line) + 4, 0), 200);
  }
}
