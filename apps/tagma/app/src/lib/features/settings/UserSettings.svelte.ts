import type { SettingKey } from '@tagma/server/platform/contract/wire/setting';
import type { WatchedSettings } from '@tagma/server/settings/contract/wire/feeds';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Result, Schema } from 'effect';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection, type LiveFailure } from '$lib/wire/Live.js';

export type UserSetting<A> = {
  readonly known: boolean;
  readonly value: A;
  readonly problem: string | null;
  write(value: A): Promise<void>;
};

type Pending<A> = { readonly value: A; readonly json: string; readonly answered: boolean };

class Held<A> implements UserSetting<A> {
  known = $state(false);
  problem = $state<string | null>(null);
  private confirmed = $state.raw<{ readonly value: A; readonly json: string } | null>(null);
  private pending = $state.raw<Pending<A> | null>(null);

  constructor(
    readonly key: SettingKey<A>,
    private readonly door: Door,
    private readonly notices: Notices,
  ) {}

  get value(): A {
    if (this.pending !== null) return this.pending.value;
    return this.confirmed === null ? this.key.fallback : this.confirmed.value;
  }

  async write(value: A): Promise<void> {
    const encoded = Schema.encodeSync(this.key.schema)(value);
    const mine: Pending<A> = { value, json: JSON.stringify(encoded), answered: false };
    this.pending = mine;
    try {
      await this.door.perform('write_setting_layer', { scope: 'user', key: this.key.id, value: encoded }, {});
      if (this.pending === mine) this.pending = { ...mine, answered: true };
    } catch (error) {
      if (this.pending === mine) this.pending = null;
      this.notices.refusal(error);
    }
  }

  heard(raw: unknown): boolean {
    const json = JSON.stringify(raw);
    const moved = this.confirmed !== null && this.confirmed.json !== json;
    const decoded = Schema.decodeUnknownResult(this.key.schema)(raw);
    if (Result.isSuccess(decoded)) {
      this.confirmed = { value: decoded.success, json };
      this.problem = null;
    } else {
      this.problem = `${this.key.id} holds a value this window cannot read: ${decoded.failure.message}`;
    }
    this.known = true;
    if (this.pending !== null && (this.pending.answered || this.pending.json === json)) this.pending = null;
    return moved;
  }

  failed(problem: string): void {
    this.problem = problem;
  }
}

export class UserSettings extends Service<UserSettings>()('UserSettings', { tier: 'app' }) {
  static *make() {
    const settings = new UserSettings(yield* Door, yield* Notices, yield* Live);
    (yield* Scope).defer(() => settings.close());
    return settings;
  }

  private readonly held = new Map<string, Held<unknown>>();
  private readonly movers = new Set<(key: string) => void>();
  private watching: { readonly unsubscribe: () => void } | null = null;
  private asked = false;
  private closed = false;

  constructor(
    private readonly door: Door,
    private readonly notices: Notices,
    private readonly live: LiveConnection,
  ) {
    super();
  }

  of<A>(key: SettingKey<A>): UserSetting<A> {
    const standing = this.held.get(key.id);
    if (standing !== undefined) return standing as unknown as Held<A>;
    const made = new Held(key, this.door, this.notices);
    this.held.set(key.id, made as unknown as Held<unknown>);
    this.rewatch();
    return made;
  }

  moved(listener: (key: string) => void): () => void {
    this.movers.add(listener);
    return () => void this.movers.delete(listener);
  }

  private rewatch(): void {
    if (this.asked) return;
    this.asked = true;
    queueMicrotask(() => {
      this.asked = false;
      if (this.closed) return;
      const keys = [...this.held.keys()];
      const before = this.watching;
      this.watching = this.live.hold(
        (client) => client['settings.watch']({ keys }),
        (event) => this.heard(event),
        (failure) => this.failed(keys, failure),
      );
      before?.unsubscribe();
    });
  }

  private heard(event: WatchedSettings): void {
    for (const [key, raw] of Object.entries(event.values)) {
      if (this.held.get(key)?.heard(raw) === true) for (const listener of this.movers) listener(key);
    }
  }

  private failed(keys: readonly string[], failure: LiveFailure): void {
    const remedy = failure.kind === 'subscription' && failure.unblock !== undefined ? failure.unblock : [];
    const problem = [failure.message, ...remedy].join(' — ');
    for (const key of keys) this.held.get(key)?.failed(problem);
    this.notices.fault(failure.kind === 'subscription' && failure.code !== undefined ? failure.code : 'settings.watch', problem);
  }

  private close(): void {
    this.closed = true;
    this.watching?.unsubscribe();
    this.watching = null;
    this.movers.clear();
  }
}
