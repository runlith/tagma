import type { AppStateEvent } from '@tagma/server/app-state/contract/wire/documents';
import type { Failure } from '@runlith/layer/Failure';
import type { PlatformStorage } from '@runlith/layer/Platform';
import type { Scope } from '@runlith/layer/Scope';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { AppStateStorage } from './AppState.js';

type Remote = { readonly value: string | null; readonly revision: number };

type Lane = { count: number; tail: Promise<void> };

class AppStateUnready extends Error {
  constructor(key: string) {
    super(`"${key}" was written before the app documents were read from the server`);
    this.name = 'AppStateUnready';
  }
}

export class ServerAppState implements AppStateStorage {
  private loaded = $state(false);
  private readonly writer = crypto.randomUUID();
  private readonly values = new Map<string, string>();
  private readonly known = new Map<string, number>();
  private readonly lanes = new Map<string, Lane>();
  private readonly held = new Map<string, Remote>();
  private readonly listeners = new Map<string, Set<(value: string | null) => void>>();
  private readonly waiting: (() => void)[] = [];
  private top = -1;
  private standing = -1;
  private reading = false;
  private wanted = 0;
  private answered = 0;

  constructor(
    private readonly door: Door,
    live: LiveConnection,
    scope: Scope,
    private readonly failure: Failure,
    private readonly local: PlatformStorage,
    private readonly moved: readonly string[],
  ) {
    const held = live.hold(
      (client) => client['app-state.changes']({}),
      (event) => this.heard(event),
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
    this.load();
  }

  get ready(): boolean {
    return this.loaded;
  }

  whenReady(act: () => void): void {
    if (this.loaded) act();
    else this.waiting.push(act);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.write(key, value);
  }

  removeItem(key: string): void {
    this.write(key, null);
  }

  keys(prefix: string): readonly string[] {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  watch(key: string, listener: (value: string | null) => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => void set.delete(listener);
  }

  private write(key: string, value: string | null): void {
    if (!this.loaded) throw new AppStateUnready(key);
    this.send(key, value);
  }

  private send(key: string, value: string | null, sent?: () => void): void {
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
    const lane = this.lanes.get(key) ?? { count: 0, tail: Promise.resolve() };
    lane.count += 1;
    lane.tail = lane.tail
      .then(() => this.door.perform('write_app_state', { key, value, writer: this.writer }, {}))
      .then(
        (answer) => {
          this.known.set(key, Math.max(this.known.get(key) ?? -1, answer.revision));
          sent?.();
        },
        (error: unknown) => {
          this.failure.report(error);
          this.known.set(key, -1);
          this.wanted += 1;
        },
      )
      .finally(() => {
        lane.count -= 1;
        if (lane.count > 0) return;
        this.lanes.delete(key);
        const waiting = this.held.get(key);
        this.held.delete(key);
        if (waiting !== undefined) this.adopt(key, waiting);
        this.settle();
      });
    this.lanes.set(key, lane);
  }

  private heard(event: AppStateEvent): void {
    if (event.kind === 'current') {
      this.standing = Math.max(this.standing, event.revision);
      this.settle();
      return;
    }
    if (event.writer !== this.writer) this.adopt(event.key, event);
  }

  private adopt(key: string, remote: Remote): void {
    if (this.lanes.has(key)) {
      const waiting = this.held.get(key);
      if (waiting === undefined || remote.revision > waiting.revision) this.held.set(key, remote);
      return;
    }
    if (remote.revision <= (this.known.get(key) ?? -1)) return;
    this.known.set(key, remote.revision);
    if ((this.values.get(key) ?? null) === remote.value) return;
    if (remote.value === null) this.values.delete(key);
    else this.values.set(key, remote.value);
    if (this.loaded) this.tell(key);
  }

  private settle(): void {
    if (!this.reading && (this.standing > this.top || this.answered < this.wanted)) this.load();
  }

  private load(): void {
    this.reading = true;
    const generation = this.wanted;
    this.door.perform('read_app_state', {}, {}).then(
      (answer) => {
        this.answered = Math.max(this.answered, generation);
        const present = new Set(answer.documents.map((document) => document.key));
        for (const document of answer.documents) this.adopt(document.key, document);
        for (const key of new Set([...this.known.keys(), ...this.values.keys()]))
          if (!present.has(key)) this.adopt(key, { value: null, revision: answer.revision });
        this.top = Math.max(this.top, answer.revision);
        this.reading = false;
        if (!this.loaded) this.open();
        this.settle();
      },
      (error: unknown) => {
        this.reading = false;
        this.failure.report(error);
      },
    );
  }

  private open(): void {
    for (const key of this.moved) {
      const kept = this.local.getItem(key);
      if (kept === null) continue;
      if (this.values.has(key)) this.local.removeItem(key);
      else this.send(key, kept, () => this.local.removeItem(key));
    }
    this.loaded = true;
    for (const key of this.listeners.keys()) this.tell(key);
    for (const act of this.waiting.splice(0)) act();
  }

  private tell(key: string): void {
    const value = this.getItem(key);
    for (const listener of [...(this.listeners.get(key) ?? [])]) listener(value);
  }
}
