import { Scope } from '@runlith/layer/Scope';
import type { MigrationLoad } from '@tagma/server/platform/contract/wire/migrationLoad';
import { Service } from '@runlith/layer/key';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import type { healthSchema } from '@tagma/server/http/contract/wire/health';
import type { MachineState } from '@tagma/server/installation/contract/wire/machine';
import type { NewHost } from '@tagma/server/installation/contract/wire/newHost';
import type { RestartHost } from '@tagma/server/installation/contract/wire/source';
import type { Installing, MachineAct, NextFrame, NextOffer, Then } from '@tagma/server/installation/contract/wire/next';
import { BUILD_ASKED_EVERY_MS } from '@tagma/server/installation/contract/wire/layout';
import { Door } from '$lib/wire/Door.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { INSTALL_WORDS } from '@tagma/server/installation/contract/wire/words';
import type { Told } from '$lib/wire/told.js';
import { Refusal, toldOf } from '$lib/wire/refusal.js';
import { Restart } from '$lib/wire/Restart.svelte.js';
import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
import { accessRefusal, WireState } from './WireState.svelte.js';

type Health = typeof healthSchema.Type;

const newHostKey = (needed: NewHost): string => `${needed.cause}:${needed.build ?? ''}:${needed.host ?? ''}`;

const keyOf = (needed: NewHost | null): string => (needed === null ? '' : newHostKey(needed));

const LATER_KEY = 'tagma.newHost.later';

type Sleep = (ms: number) => Promise<void>;

const slept: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type StandingActing =
  | {
      readonly _tag: 'Restart';
      readonly onto: string;
      readonly update: Installing | null;
    }
  | {
      readonly _tag: 'Install';
      readonly installing: Installing;
    };

export class Standing extends Service<Standing>()('Standing', { tier: 'app' }) {
  static *make() {
    const door = yield* Door;
    return new Standing(
      door,
      yield* ServerOrigin,
      yield* Scope,
      yield* Restart,
      yield* Live,
      yield* SessionNaming,
      yield* WireState,
      (yield* Platform).storage.local,
    );
  }

  health = $state<Health | null>(null);
  private snapshot = $state<MachineState | null>(null);
  private nextFrame = $state<NextFrame | null>(null);
  private liveProblem = $state<Told | null>(null);
  private readProblem = $state<Told | null>(null);
  machine = $derived.by((): MachineState | null => {
    const machine = this.snapshot;
    const frame = this.nextFrame;
    if (
      machine === null ||
      frame === null ||
      frame.instance !== machine.server.next.instance ||
      frame.revision <= machine.server.next.revision
    )
      return machine;
    return { ...machine, server: { ...machine.server, next: frame } };
  });
  next = $derived(this.machine?.server.next ?? null);
  upcoming = $derived.by((): NextOffer | null => {
    const next = this.next;
    return next === null || next.update === null ? null : (next.offers.find((offer) => offer.id === next.update) ?? null);
  });
  private heard = 0;
  private hostSaid = $state<{ readonly newHost: NewHost | null; readonly at: number } | null>(null);
  private snapshotAt = $state(0);
  newHost = $derived(
    this.hostSaid !== null && this.hostSaid.at > this.snapshotAt ? this.hostSaid.newHost : (this.snapshot?.newHost ?? null),
  );
  private later = $state<string | null>(null);
  offersNewHost = $derived(this.newHost !== null && newHostKey(this.newHost) !== this.later);
  readAt = $state<number | null>(null);
  acting = $state<StandingActing | null>(null);
  restarting = $state<string | null>(null);
  private actionProblem = $state<Told | null>(null);
  problem = $derived.by((): Told | null => {
    const issue = this.next?.issue ?? null;
    return (
      this.actionProblem ??
      (issue === null ? null : { text: INSTALL_WORDS[issue.code].text, details: [issue.reason, ...issue.unblock] }) ??
      this.liveProblem ??
      this.readProblem ??
      (this.next !== null && this.next.standing.tone !== 'alone' && !this.next.watched
        ? { text: 'Updates are not being followed right now; this is the last reading.', details: [] }
        : null)
    );
  });
  quietSince = $state<number | null>(null);
  stopping = $state<string | null>(null);
  checking = $state(false);
  private reading: Promise<void> | null = null;
  private readAfter = false;
  private disposed = false;

  constructor(
    private readonly door: Door,
    private readonly origin: ServerOrigin,
    scope: Scope,
    private readonly restartWindow: Restart,
    live: LiveConnection | null = null,
    private readonly naming: SessionNaming | null = null,
    private readonly wire: WireState | null = null,
    private readonly kept: PlatformStorage | null = null,
  ) {
    super();
    this.later = kept?.getItem(LATER_KEY) ?? null;
    scope.defer(() => {
      this.disposed = true;
    });
    if (live !== null) {
      scope.defer(
        live.hold(
          (client) => client['installation.next']({}),
          (frame) => {
            if (!this.advance(frame)) return;
            this.liveProblem = null;
            this.readAt = Date.parse(frame.readAt);
            const said = frame.newHost ?? null;
            const moved = keyOf(said) !== keyOf(this.newHost);
            if (moved) this.hostSaid = { newHost: said, at: ++this.heard };
            if (moved || (this.snapshot !== null && this.snapshot.server.next.instance !== frame.instance)) {
              this.readAfter = true;
              void this.read();
            }
          },
          (failure) => {
            this.liveProblem = { text: 'Updates are not being followed right now; this is the last reading.', details: [failure.message] };
          },
        ).unsubscribe,
      );
      let opened = false;
      scope.defer(
        live.subscribeStatus((status) => {
          if (status !== 'open') return;
          if (opened || this.quietSince !== null) void this.read();
          opened = true;
        }),
      );
    }
    void this.read();
    if (typeof window === 'undefined') return;
    const wake = () => void this.read();
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    scope.defer(() => {
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    });
  }

  get ready(): string | null {
    const read = this.health;
    if (read === null || read.source.installation === null || read.standing === null) return null;
    return read.standing.build === read.source.installation.build ? null : read.standing.build;
  }

  act(name: MachineAct['act']): MachineAct | null {
    const machine = this.machine;
    if (machine === null) return null;
    return [...machine.acts, ...machine.server.next.acts].find((act) => act.act === name) ?? null;
  }

  offer(id: string): NextOffer | null {
    const next = this.next;
    if (next === null) return null;
    return [...next.offers, ...(next.back === null ? [] : [next.back])].find((offer) => offer.id === id) ?? null;
  }

  read(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.reading ??= this.readLoop().finally(() => (this.reading = null));
    return this.reading;
  }

  private async readLoop(): Promise<void> {
    do {
      this.readAfter = false;
      await this.readOnce();
    } while (this.readAfter && !this.disposed);
  }

  private async readOnce(): Promise<void> {
    void this.restartWindow.reloadIfBehind();
    try {
      this.health = await this.door.ask((api) => api.health.health());
      if (this.naming !== null) this.naming.identity = this.health.sessionIdentity;
      this.origin.declare(this.health);
      this.quietSince = null;
    } catch (caught) {
      const refusal = caught instanceof Refusal ? accessRefusal(caught.code) : null;
      if (refusal !== null) this.wire?.refuse(refusal);
      else if (this.acting === null) this.quietSince ??= Date.now();
      return;
    }
    try {
      const requestedInstance = this.nextFrame?.instance;
      const asked = ++this.heard;
      const machine = (await this.door.perform('read_machine_state', {}, {})).machine;
      if (this.disposed) return;
      if (this.nextFrame !== null && machine.server.next.instance !== this.nextFrame.instance) {
        if (this.nextFrame.instance !== requestedInstance) {
          this.readAfter = true;
          return;
        }
        this.nextFrame = null;
      }
      this.snapshot = machine;
      this.snapshotAt = asked;
      this.readProblem = null;
      this.readAt = Date.now();
    } catch (caught) {
      this.readProblem = toldOf(caught);
    }
  }

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.actionProblem = null;
    try {
      const { next } = await this.door.perform('check_for_updates', {}, {});
      if (this.advance(next)) this.readAt = Date.parse(next.readAt);
    } catch (error) {
      this.actionProblem = toldOf(error);
    } finally {
      this.checking = false;
    }
    this.readAfter = true;
    await this.read();
  }

  private advance(frame: NextFrame): boolean {
    const prior = this.nextFrame;
    if (prior !== null && prior.instance === frame.instance && prior.revision > frame.revision) return false;
    this.nextFrame = frame;
    return true;
  }

  putOff(): void {
    if (this.newHost === null) return;
    this.later = newHostKey(this.newHost);
    this.kept?.setItem(LATER_KEY, this.later);
  }

  private askAgain(): void {
    this.later = null;
    this.kept?.removeItem(LATER_KEY);
  }

  async restart(host?: RestartHost): Promise<void> {
    if (this.acting !== null) return;
    const wanted = this.ready ?? this.health?.source.installation?.build ?? 'the installation that stands';
    this.acting = { _tag: 'Restart', onto: wanted, update: null };
    this.restarting = wanted;
    this.actionProblem = null;
    let heavy: MigrationLoad | undefined;
    try {
      heavy = (await this.door.perform('restart_server', { host }, {})).restart.heavy;
    } catch (error) {
      this.acting = null;
      this.restarting = null;
      if (error instanceof Refusal && error.code === 'host-unprepared') {
        this.askAgain();
        await this.read();
        if (this.newHost !== null) return;
      }
      this.actionProblem = toldOf(error);
      return;
    }
    await this.successor(heavy);
  }

  private async begin(offer: string, then: Then | undefined): Promise<Installing | null> {
    try {
      return (await this.door.perform('install_next', { offer, then }, {})).installing;
    } catch (error) {
      this.actionProblem = toldOf(error);
      return null;
    }
  }

  async update(offer: string, sleep: Sleep = slept): Promise<void> {
    if (this.acting !== null) return;
    this.actionProblem = null;
    const leaving = this.machine?.server.pid ?? null;
    const started = await this.begin(offer, 'restart');
    if (started === null) return;
    this.acting = { _tag: 'Install', installing: started };
    let onto = started.target;
    for (;;) {
      await sleep(BUILD_ASKED_EVERY_MS);
      let machine: MachineState;
      try {
        machine = (await this.door.perform('read_machine_state', {}, {})).machine;
      } catch {
        const answering = await this.door
          .ask((api) => api.health.health())
          .then(
            () => true,
            () => false,
          );
        if (answering) continue;
        break;
      }
      this.snapshot = machine;
      this.readAt = Date.now();
      const server = machine.server;
      if (server.next.installing !== null && server.next.installing.since === started.since) continue;
      const ended = server.next.installed;
      if (ended === null || ended.since !== started.since) {
        this.acting = null;
        this.actionProblem = {
          text: 'Tagma lost track of the update it started. Look for updates again.',
          details: ['the server no longer answers for the installation it started'],
        };
        return;
      }
      if (ended.outcome === 'failed') {
        this.acting = null;
        return;
      }
      if (ended.outcome === 'stopped' || (ended.restartRefused !== null && this.stopping === started.since)) {
        this.acting = null;
        return;
      }
      if (ended.restartRefused !== null) {
        this.acting = null;
        this.askAgain();
        if (machine.newHost !== undefined) return;
        this.actionProblem = {
          text: 'The update is installed, but Tagma could not restart onto it. Restart to apply it.',
          details: [ended.restartRefused],
        };
        return;
      }
      onto = ended.build ?? started.target;
      if (leaving !== null && server.pid !== leaving) {
        this.acting = null;
        await this.restartWindow.reloadIfBehind();
        return;
      }
      break;
    }
    this.acting = { _tag: 'Restart', onto, update: started };
    this.restarting = onto;
    await this.successor();
  }

  private async successor(heavy?: MigrationLoad): Promise<void> {
    const arrival = await this.restartWindow.open(true, this.machine?.server.pid ?? null, heavy);
    this.acting = null;
    this.restarting = null;
    if (arrival._tag === 'Stayed')
      this.actionProblem = {
        text: 'Tagma did not restart and keeps running as it was. Try again.',
        details: [arrival.failure ?? 'the server answered as it was, with no restart under way'],
      };
  }

  async install(offer: string, sleep: Sleep = slept): Promise<void> {
    if (this.acting !== null) return;
    this.actionProblem = null;
    const started = await this.begin(offer, undefined);
    if (started === null) return;
    this.acting = { _tag: 'Install', installing: started };
    try {
      for (;;) {
        await sleep(BUILD_ASKED_EVERY_MS);
        await this.read();
        const next = this.next;
        if (next === null) continue;
        if (next.installing !== null && next.installing.since === started.since) continue;
        return;
      }
    } finally {
      this.acting = null;
    }
  }

  async placeCommand(): Promise<void> {
    this.actionProblem = null;
    try {
      await this.door.perform('place_command', {}, {});
    } catch (error) {
      this.actionProblem = toldOf(error);
    }
    await this.read();
  }

  async stop(since: string): Promise<void> {
    if (this.stopping === since) return;
    this.stopping = since;
    this.actionProblem = null;
    try {
      await this.door.perform('stop_installing', {}, {});
    } catch (error) {
      this.stopping = null;
      this.actionProblem = toldOf(error);
    }
    await this.read();
  }
}
