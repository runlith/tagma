import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ASKED_EVERY_MS } from '@tagma/server/installation/contract/wire/layout';
import { RESTARTING_CLOSE } from '@tagma/server/platform/contract/wire/live';
import type { MigrationLoad } from '@tagma/server/platform/contract/wire/migrationLoad';
import type { RestartDoor, Startup, StartupState } from '@tagma/server/installation/contract/wire/restart';
import { type BuildPort, ClientBuild } from './ClientBuild.js';
import { Door } from './Door.js';
import { Live, type LiveConnection } from './Live.js';
import { Refusal } from './refusal.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

export type Arrival = { readonly _tag: 'Returned' } | { readonly _tag: 'Stayed'; readonly failure: string | null };

const RETURNED: Arrival = { _tag: 'Returned' };

export type RestartOptions = {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

type Held = { readonly since: number; readonly clientId: string; readonly reloaded: boolean };

type Place = { readonly projectId: number; readonly threadId: string; readonly at: number };

const KEY = 'tagma.restart';
const STALE_MS = 600_000;
const NO_THREAD_MS = 1_500;

const slept = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class Restart extends Service<Restart>()('Restart', { tier: 'app' }) {
  static *make() {
    return new Restart(
      yield* Door,
      yield* Live,
      yield* ServerOrigin,
      (yield* Platform).storage.session,
      yield* ClientBuild,
      yield* Router,
      yield* Scope,
    );
  }

  since = $state<number | null>(null);
  startup = $state.raw<Startup | null>(null);
  heavy = $state.raw<MigrationLoad | null>(null);
  quietSince = $state<number | null>(null);
  returning = $state(false);
  announced = $state(false);
  stayed = $state<string | null>(null);

  private clientId = '';
  private reloaded = false;
  private running: Promise<Arrival> | null = null;
  private leaving: number | null = null;
  private replaced = false;
  private asked = false;
  private dropped = false;
  private closed = false;
  private watching = 0;
  private placed: Place | null = null;
  private liveOpen = false;
  private grace: ReturnType<typeof setTimeout> | null = null;
  private settled: ((arrival: Arrival) => void) | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly door: Door,
    live: LiveConnection,
    private readonly origin: ServerOrigin,
    private readonly storage: PlatformStorage,
    private readonly build: BuildPort,
    private readonly router: Router,
    scope: Scope,
    options: RestartOptions = {},
  ) {
    super();
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? slept;
    scope.defer(
      live.subscribeFailure((failure) => {
        if (failure.code === RESTARTING_CLOSE) this.open(true, null);
      }),
    );
    scope.defer(
      live.subscribeStatus((status) => {
        this.liveOpen = status === 'open';
        if (status === 'closed') {
          this.open(false, null);
          this.dropped = true;
        } else this.settle();
      }),
    );
    scope.defer(() => this.dispose());
    const held = this.held();
    if (held !== null) {
      this.clientId = held.clientId;
      this.reloaded = held.reloaded;
      this.since = held.since;
      this.replaced = true;
      this.announced = true;
      this.dropped = true;
      this.running = this.run(true);
    }
  }

  open(acted: boolean, leaving: number | null, heavy?: MigrationLoad): Promise<Arrival> {
    if (heavy !== undefined) this.heavy = heavy;
    this.leaving ??= leaving;
    if (this.running !== null) {
      if (acted) {
        this.asked = true;
        this.announced = true;
        this.persist();
      }
      return this.running;
    }
    if (this.clientId === '') this.clientId = crypto.randomUUID();
    this.stayed = null;
    this.announced = acted;
    this.asked = acted;
    this.since = this.now();
    this.reloaded = false;
    this.replaced = false;
    this.dropped = false;
    if (acted) this.persist();
    this.running = this.run(false);
    return this.running;
  }

  dismiss(): void {
    this.stayed = null;
  }

  watch(): () => void {
    this.watching += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watching -= 1;
      this.settle();
    };
  }

  placeReturned(projectId: number, threadId: string): void {
    if (this.since === null || this.placed !== null || !(this.dropped || this.returning)) return;
    this.placed = { projectId, threadId, at: this.now() };
    this.settle();
  }

  private dispose(): void {
    this.closed = true;
    if (this.grace !== null) clearTimeout(this.grace);
    this.grace = null;
  }

  async reloadIfBehind(): Promise<void> {
    if (this.since !== null) return;
    if (await this.lagging()) this.router.reload();
  }

  private lagging(): Promise<boolean> {
    return this.door.contractMoved && this.door.idle ? Promise.resolve(true) : this.build.behind();
  }

  private async run(resumed: boolean): Promise<Arrival> {
    let gap = resumed;
    for (;;) {
      await this.sleep(ASKED_EVERY_MS);
      if (this.since === null || this.closed) return RETURNED;
      let state: StartupState;
      try {
        state = await this.door.ask((api) => api.health.startup());
      } catch (caught) {
        if (!this.asked && caught instanceof Refusal && caught.code !== 'transport') return this.arrive();
        gap = true;
        this.quietSince ??= this.now();
        continue;
      }
      this.quietSince = null;
      const handover = state.restart ?? null;
      if (handover?.stays === true) return this.finish(null, this.asked ? { _tag: 'Stayed', failure: handover.failure } : RETURNED);
      const answered: Startup | null = state.startup;
      if (answered === null) continue;
      this.startup = answered;
      if (answered.heavy !== undefined) this.heavy = answered.heavy;
      if (answered.status !== 'ready') {
        gap = true;
        if (!this.announced) {
          this.announced = true;
          this.persist();
        }
        continue;
      }
      if (this.leaving === null && !gap) this.leaving = answered.pid;
      const replaced = handover?.stage === 'serving' || handover?.stage === 'restored';
      if (!gap && answered.pid === this.leaving && !(this.asked && replaced)) {
        if (!this.asked) return this.finish(null, RETURNED);
        if (handover?.underway === true) continue;
        return this.finish(null, { _tag: 'Stayed', failure: handover?.failure ?? null });
      }
      this.replaced = true;
      return this.arrive();
    }
  }

  private async arrive(): Promise<Arrival> {
    this.returning = true;
    try {
      await this.door.ask((api) => api.health.health());
    } catch {
      return this.finish(null, RETURNED);
    }
    if (this.closed) return RETURNED;
    if (!this.reloaded && (await this.lagging())) {
      this.reloaded = true;
      this.persist();
      this.router.reload();
      return new Promise<Arrival>(() => undefined);
    }
    return new Promise<Arrival>((resolve) => {
      this.settled = resolve;
      this.settle();
    });
  }

  private settle(): void {
    if (!this.returning || this.settled === null) return;
    if (this.placed !== null) {
      this.finish(this.placed, RETURNED);
      return;
    }
    if (this.liveOpen && this.watching === 0 && this.grace === null) {
      this.grace = setTimeout(() => {
        this.grace = null;
        if (this.returning && this.placed === null && this.watching === 0) this.finish(null, RETURNED);
      }, NO_THREAD_MS);
    }
  }

  private finish(place: Place | null, arrival: Arrival): Arrival {
    const since = this.since;
    const reported = since !== null && place !== null && this.replaced;
    const duration = since === null ? 0 : (place?.at ?? this.now()) - since;
    const resolve = this.settled;
    if (this.grace !== null) clearTimeout(this.grace);
    this.grace = null;
    this.settled = null;
    this.since = null;
    this.heavy = null;
    this.returning = false;
    this.announced = false;
    this.asked = false;
    this.dropped = false;
    this.running = null;
    this.leaving = null;
    this.placed = null;
    this.quietSince = null;
    this.stayed = arrival._tag === 'Stayed' ? (arrival.failure ?? 'The server answered as it was, with no restart under way.') : null;
    this.storage.removeItem(KEY);
    if (reported) void this.report(place, duration);
    resolve?.(arrival);
    return arrival;
  }

  private async report(place: Place, durationMs: number): Promise<void> {
    try {
      const machine = (await this.door.perform('read_machine_state', {}, {})).machine;
      const restartId = machine.restart.record?.id;
      if (restartId === undefined) return;
      const door: RestartDoor = this.origin.local ? 'local' : 'remote';
      await this.door.perform(
        'report_restart_window',
        { restartId, clientId: this.clientId, door, projectId: place.projectId, threadId: place.threadId, durationMs },
        {},
      );
    } catch {
      return;
    }
  }

  private held(): Held | null {
    const raw = this.storage.getItem(KEY);
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (
        typeof value === 'object' &&
        value !== null &&
        'since' in value &&
        'clientId' in value &&
        'reloaded' in value &&
        typeof value.since === 'number' &&
        typeof value.clientId === 'string' &&
        typeof value.reloaded === 'boolean' &&
        this.now() - value.since < STALE_MS
      )
        return { since: value.since, clientId: value.clientId, reloaded: value.reloaded };
    } catch {
      return null;
    }
    return null;
  }

  private persist(): void {
    if (this.since === null) return;
    this.storage.setItem(KEY, JSON.stringify({ since: this.since, clientId: this.clientId, reloaded: this.reloaded }));
  }
}
