import { watch } from 'node:fs';
import { join } from 'node:path';
import { RESTART_RECORD } from '@tagma/server/installation/contract/wire/restart';
import { CHANNEL } from '@tagma/server/composition/channel';
import { currentVersion } from '@tagma/server/installation/closure/versions';
import { ASKED_EVERY_MS, dataDirectory, installationsRoot, serveLogPath } from '@tagma/server/installation/contract/wire/layout';
import type { Channel } from '@tagma/server/installation/contract/wire/channel';
import { ATTEMPT_OPEN } from '@tagma/server/installation/contract/wire/attempt';
import { activeElsewhere, closureOf, installFrom, switchOver, transferable, transferFrom } from './installation.js';
import {
  type Bearing,
  branchOf,
  bundleOf,
  carriedBy,
  carriedIn,
  type Fallen,
  fallen,
  installedAs,
  keptApplication,
  keptPath,
  numbered,
  standingIn,
  type Standing,
} from './release.js';
import {
  askRestart,
  type Closure,
  dataHeld,
  endStalled,
  handover,
  machineWork,
  reach,
  type Refusal,
  type ServerHandle,
  startServer,
  startupLeft,
} from './server.js';
import { become, keepCopy, replaceAt, settleOwn } from './placing.js';
import type { LoaderState } from './waitingPage.js';

export type Opening = {
  readonly executable: string;
  readonly env: NodeJS.ProcessEnv;
  readonly named: boolean;
};

export type LoaderWindow = {
  readonly open: () => void;
  readonly show: (standing: LoaderState) => void;
  readonly offer: (from: Channel) => Promise<boolean>;
  readonly ask: (said: string, reason: string) => Promise<boolean>;
  readonly told: (title: string, refusal: Refusal) => void;
  readonly reopen: (bundle: string) => void;
  readonly settled: (release: string, signal: AbortSignal) => void | Promise<void>;
  readonly fell: (fallen: Fallen) => Promise<'retry' | 'left'>;
};

type Places = { readonly installRoot: string; readonly data: string; readonly log: string };

type Went = 'go' | 'gone' | 'stood';

type Served = { readonly installation: Bearing | null } | 'stood' | 'again';

type Started = { readonly handle: ServerHandle; readonly version: string | null };

const sleep = (ms: number): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

const HELD_ASKED_EVERY_MS = 1_000;

const SERVER_WATCH_MS = 2_000;

const DAMAGED = 'The copy of Tagma kept on this Mac is damaged, so this app was left as it is. Report the problem so it can be put right.';

export class SurfaceLoader {
  private onSurface = false;
  private started: Started | null = null;
  private deciding = false;
  private standing: LoaderState | null = null;
  private held: Closure | null = null;
  private settledOn = false;
  private declined = false;
  private asked: string | null = null;
  private pending: string | null = null;
  private heldUntil = 0;
  private watching: ReturnType<typeof setTimeout> | null = null;
  private readonly lifetime = new AbortController();
  private readonly damaged = new Set<string>();
  private readonly bundle: string | null;
  private readonly places: Places | null;

  constructor(
    private readonly surfaceUrl: URL,
    private readonly opening: Opening,
    private readonly window: LoaderWindow,
  ) {
    this.bundle = bundleOf(opening.executable);
    const [installRoot, data, log] = [
      installationsRoot(CHANNEL, opening.env),
      dataDirectory(CHANNEL, opening.env),
      serveLogPath(CHANNEL, opening.env),
    ];
    this.places = installRoot === null || data === null || log === null ? null : { installRoot, data, log };
  }

  start(): void {
    this.onSurface = false;
    this.standing = null;
    if (this.deciding) return;
    const bundle = this.bundle;
    this.run(async () => {
      if (bundle !== null) await settleOwn(bundle);
      await this.meet();
    });
  }

  loadFailed(): void {
    this.onSurface = false;
    if (this.opening.named) {
      this.stand({ why: 'named-address' });
      return;
    }
    if (this.deciding) {
      if (this.standing !== null) this.window.show(this.standing);
      return;
    }
    this.run(() => this.meet());
  }

  focused(): void {
    const looked = this.standing === null || this.standing.why === 'not-started' || this.standing.why === 'foreign' || this.opening.named;
    if (!this.onSurface && !this.deciding && looked) this.run(() => this.meet());
  }

  navigated(): void {
    this.onSurface = true;
    if (!this.deciding) this.run(() => this.meet());
  }

  retry(): void {
    if (this.deciding) return;
    this.declined = false;
    this.asked = null;
    this.run(() => this.meet());
  }

  switchOver(): void {
    const held = this.held;
    const places = this.places;
    if (held === null || places === null || this.deciding) return;
    this.run(async () => {
      this.stand({ why: 'switching', from: this.standing?.why === 'channel-active' ? this.standing.holder.name : 'the other Tagma' });
      const refused = await switchOver(held, places.log, this.opening.env);
      if (refused !== null) {
        this.stand({ why: 'unknown', detail: `the other Tagma was not switched off: ${refused}` });
        return;
      }
      this.held = null;
      await this.meet();
    });
  }

  arrived(copy: string): void {
    if (copy === this.bundle && carriedBy(copy)?.digest === this.own()?.digest) return;
    if (this.deciding) {
      this.pending = copy;
      return;
    }
    this.run(() => this.adopt(copy));
  }

  private own(): Bearing | null {
    return this.bundle === null ? null : carriedBy(this.bundle);
  }

  private get left(): boolean {
    return this.lifetime.signal.aborted;
  }

  private run(work: () => Promise<void>): void {
    if (this.left) return;
    this.deciding = true;
    void work()
      .catch((error: unknown) => {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        if (this.left) console.error(`[tagma-desktop] opening ended after the window left: ${detail}`);
        else this.stand({ why: 'unknown', detail });
      })
      .finally(() => {
        this.deciding = false;
        const copy = this.pending;
        this.pending = null;
        if (copy !== null) this.arrived(copy);
      });
  }

  private stand(standing: LoaderState): void {
    this.onSurface = false;
    this.standing = standing;
    this.window.show(standing);
  }

  private openSurface(): void {
    this.watch();
    if (this.onSurface) return;
    this.onSurface = true;
    this.standing = null;
    this.window.open();
  }

  leave(): void {
    this.lifetime.abort();
    if (this.watching !== null) clearTimeout(this.watching);
    this.watching = null;
  }

  private watch(): void {
    const places = this.places;
    if (this.left || this.watching !== null || places === null || this.opening.named) return;
    this.watching = setTimeout(() => {
      void reach(this.surfaceUrl, places.data).then((reached) => {
        this.watching = null;
        if (this.left || !this.onSurface) return;
        const lost = reached.at === 'silent' || (reached.at === 'ours' && reached.stalled !== null);
        if (lost && !this.deciding) this.run(() => this.meet());
        else this.watch();
      });
    }, SERVER_WATCH_MS);
  }

  private async meet(): Promise<void> {
    if (this.opening.named) {
      this.openSurface();
      return;
    }
    const places = this.places;
    if (places === null) {
      this.stand({ why: 'unknown', detail: 'neither TAGMA_DATABASE_PATH nor HOME names a place for Tagma' });
      return;
    }
    const bundle = this.bundle;
    const own = this.own();
    const selecting = own !== null && numbered(own);
    if (bundle !== null && own !== null) {
      await this.keep(bundle, own, places);
      if ((await this.converged(bundle, own, selecting, places)) !== 'go') return;
    }
    let served = await this.served(places, null);
    if (served === 'again') return this.meet();
    if (served === 'stood') return;
    if (selecting) {
      const awaited = await this.restarted(served.installation, places);
      if (awaited === 'again') return this.meet();
      if (awaited !== null) {
        served = await this.served(places, awaited);
        if (served === 'again') return this.meet();
        if (served === 'stood') return;
      }
    } else if (own !== null && served.installation !== null && served.installation.digest !== own.digest) {
      const running = installedAs(places.installRoot, served.installation);
      if (running !== null && (await this.followed(own, running, places)) === 'gone') return;
    }
    if (own !== null) await this.settle(own, places);
    if (this.left) return;
    this.openSurface();
    const fell = fallen(places.installRoot);
    if (fell?.fell !== 'rolled-back' || fell.to?.digest === own?.digest) return;
    if ((await this.window.fell(fell)) === 'retry' && fell.to !== null) await this.retried(fell.to, places);
  }

  private async keep(bundle: string, own: Bearing, places: Places): Promise<void> {
    const mine = installedAs(places.installRoot, own);
    if (mine === null) return;
    await keepCopy(bundle, own, keptPath(places.installRoot, mine.version), places.installRoot).catch((error: unknown) =>
      console.warn(`[tagma-desktop] the kept copy of ${own.build} could not be restored from ${bundle}: ${String(error)}`),
    );
  }

  private async retried(to: Standing, places: Places): Promise<void> {
    const kept = keptApplication(places.installRoot, to);
    if (kept === null) return;
    this.stand({ why: 'installing', build: to.build });
    const answer = await installFrom(carriedIn(kept), places.log, true, this.opening.env);
    if (answer.status === 'refused') this.window.told(`${CHANNEL.name} ${to.build} didn't install`, answer.refusal);
    await this.meet();
  }

  private async settle(own: Bearing, places: Places): Promise<void> {
    const mine = installedAs(places.installRoot, own);
    if (mine === null || this.left) return;
    await this.window.settled(mine.version, this.lifetime.signal);
    this.settledOn ||= standingIn(places.installRoot)?.digest === own.digest;
  }

  private async converged(bundle: string, own: Bearing, selecting: boolean, places: Places): Promise<Went> {
    const standing = standingIn(places.installRoot);
    if (!selecting)
      return this.declined || installedAs(places.installRoot, own) !== null ? 'go' : this.installed(bundle, own, standing !== null, places);
    const branch = branchOf(own, standing, places.installRoot, this.settledOn);
    if (branch === 'equal') return 'go';
    if (branch === 'follow' && standing !== null) return this.followed(own, standing, places);
    if (this.declined) return 'go';
    return this.installed(bundle, own, standing !== null, places);
  }

  private async followed(own: Bearing, standing: Standing, places: Places): Promise<Went> {
    const kept = keptApplication(places.installRoot, standing);
    if (kept === null) {
      console.warn(`[tagma-desktop] release ${standing.build} stands with no copy of its application, so this window stays as it is`);
      return 'go';
    }
    if (!numbered(own)) {
      this.window.reopen(kept);
      return 'gone';
    }
    if (this.damaged.has(kept)) return 'go';
    const placed = await become(this.bundle, kept, places.installRoot);
    if ('refused' in placed) {
      this.refused(placed.refused, kept, standing);
      return 'go';
    }
    this.window.reopen(placed.placed);
    return 'gone';
  }

  private refused(reason: string, kept: string, standing: Standing): void {
    this.damaged.add(kept);
    this.window.told(`${CHANNEL.name} couldn't update this app to ${standing.build}`, { code: 'copy-damaged', reason, said: DAMAGED });
  }

  private async installed(bundle: string, bearing: Bearing, standing: boolean, places: Places): Promise<Went> {
    this.stand({ why: 'installing', build: bearing.build });
    let answer = await installFrom(carriedIn(bundle), places.log, false, this.opening.env);
    if (answer.status === 'refused' && answer.refusal.code === ATTEMPT_OPEN) {
      if ((await this.served(places, null)) === 'stood') return 'stood';
      this.stand({ why: 'installing', build: bearing.build });
      answer = await installFrom(carriedIn(bundle), places.log, false, this.opening.env);
    }
    if (answer.status === 'ask') {
      if (!(await this.window.ask(answer.said, answer.reason))) {
        this.declined = true;
        return 'go';
      }
      this.stand({ why: 'installing', build: bearing.build });
      answer = await installFrom(carriedIn(bundle), places.log, true, this.opening.env);
    }
    if (answer.status === 'landed') return 'go';
    if (answer.status === 'held') {
      this.declined = true;
      return 'go';
    }
    const refusal: Refusal = answer.status === 'refused' ? answer.refusal : { code: 'asked-again', reason: answer.said, said: null };
    if (!standing) {
      this.stand({ why: 'not-installed', build: bearing.build, said: refusal.said, detail: `${refusal.code}: ${refusal.reason}` });
      return 'stood';
    }
    this.declined = true;
    this.window.told(`${CHANNEL.name} ${bearing.build} didn't install`, refusal);
    return 'go';
  }

  private async adopt(copy: string): Promise<void> {
    const places = this.places;
    const bearing = carriedBy(copy);
    if (places === null || bearing === null || this.opening.named) return;
    const standing = standingIn(places.installRoot);
    const branch = branchOf(bearing, standing, places.installRoot, false);
    if (branch === 'equal') return;
    if (branch === 'follow' && standing !== null) {
      const kept = keptApplication(places.installRoot, standing);
      if (kept === null) return;
      const placed = await replaceAt(copy, kept, places.installRoot);
      if (placed === null) console.warn(`[tagma-desktop] ${copy} cannot be written, so it keeps the release it carries`);
      else if ('refused' in placed) this.refused(placed.refused, kept, standing);
      return;
    }
    this.declined = false;
    if ((await this.installed(copy, bearing, standing !== null, places)) !== 'go') return;
    await this.meet();
  }

  private async restarted(served: Bearing | null, places: Places): Promise<string | 'again' | null> {
    const standing = standingIn(places.installRoot);
    const own = this.own();
    if (served === null || standing === null || own === null || own.digest !== standing.digest) return null;
    if (served.digest === standing.digest) return null;
    const divergence = `${served.digest}>${standing.digest}`;
    if (this.asked === divergence) return null;
    const work = await machineWork(this.surfaceUrl);
    if (work?.busy === true) {
      while ((await machineWork(this.surfaceUrl))?.busy === true) await sleep(ASKED_EVERY_MS);
      return 'again';
    }
    this.asked = divergence;
    if (work?.needsHost === standing.build) return null;
    this.stand({ why: 'starting' });
    const before = (await handover(places.data))?.id;
    const refused = await askRestart(this.surfaceUrl);
    if (refused === null) return standing.digest;
    const after = await handover(places.data);
    if (refused.code === 'unanswered' && after !== null && after.id !== before) return standing.digest;
    if ((await machineWork(this.surfaceUrl))?.needsHost === standing.build) return null;
    this.window.told(`${CHANNEL.name} couldn't switch to ${standing.build}`, refused);
    return null;
  }

  private async served(places: Places, awaited: string | null): Promise<Served> {
    if (this.left) return 'stood';
    let revision = 0;
    let notify: (() => void) | null = null;
    let observed: ServerHandle | null = null;
    let watcher: ReturnType<typeof watch> | null = null;
    const unwatch = () => watcher?.close();
    const changed = () => {
      revision += 1;
      notify?.();
    };
    const observe = () => {
      if (watcher !== null || this.left) return;
      try {
        const created = watch(places.data, { persistent: false, signal: this.lifetime.signal }, (_event, name) => {
          if (name === null || name.toString() === RESTART_RECORD) changed();
        });
        created.on('error', (error) => {
          created.close();
          if (watcher === created) watcher = null;
          if (this.left) return;
          console.warn(`[tagma-desktop] startup observation failed; health polling continues: ${String(error)}`);
          changed();
        });
        watcher = created;
        changed();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.warn(`[tagma-desktop] startup cannot be observed; health polling continues: ${String(error)}`);
      }
    };
    observe();
    const pause = (seen: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          if (notify !== done) return;
          notify = null;
          clearTimeout(timer);
          this.lifetime.signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, ASKED_EVERY_MS);
        notify = done;
        this.lifetime.signal.addEventListener('abort', done, { once: true });
        if (this.left || revision !== seen) done();
      });
    try {
      for (;;) {
        if (this.left) return 'stood';
        const seen = revision;
        const reached = await reach(this.surfaceUrl, places.data);
        if (this.left) return 'stood';
        if (reached.at === 'foreign') {
          this.stand({ why: 'foreign' });
          return 'stood';
        }
        if (reached.at === 'ours' && reached.stalled !== null) {
          this.stand({ why: 'stalled', heldFor: reached.stalled.heldFor, seconds: Math.round(reached.stalled.heldMs / 1000) });
          await endStalled(reached.stalled, places.log);
          this.started = null;
          await pause(seen);
          continue;
        }
        if (reached.at === 'ours' && (await this.caught(reached.installation, awaited, places))) {
          this.started = null;
          return { installation: reached.installation };
        }
        if (reached.at === 'silent') {
          const went = await this.unanswered(places);
          if (went !== null) return went;
        }
        const handle = this.started?.handle ?? null;
        if (handle !== null && handle !== observed) {
          observed = handle;
          observe();
          void handle.exited.then(changed);
        }
        if (this.standing?.why !== 'starting' && this.standing?.why !== 'stalled' && !this.onSurface) this.stand({ why: 'starting' });
        await pause(seen);
      }
    } finally {
      unwatch();
    }
  }

  private async caught(installation: Bearing | null, awaited: string | null, places: Places): Promise<boolean> {
    const standing = standingIn(places.installRoot);
    if (awaited === null || installation === null || installation.digest === standing?.digest) return true;
    const passing = await handover(places.data);
    if (passing?.underway === true) return false;
    if (standing !== null)
      this.window.told(`${CHANNEL.name} couldn't switch to ${standing.build}`, {
        code: 'restart-failed',
        reason: passing?.failure ?? `the server came back on ${installation.build}`,
        said: null,
      });
    return true;
  }

  private async unanswered(places: Places): Promise<'stood' | 'again' | null> {
    const started = this.started;
    const ended = started?.handle.ended() ?? null;
    if (started !== null && ended === null) return null;
    const planned = await closureOf(places.installRoot);
    if (!('closure' in planned)) {
      this.stand(planned.unreadable ? { why: 'unknown', detail: planned.missing } : { why: 'no-installation', detail: planned.missing });
      return 'stood';
    }
    if (Date.now() < this.heldUntil) return null;
    if (await dataHeld(planned.closure.runtime, places.data, this.opening.env)) {
      this.heldUntil = Date.now() + HELD_ASKED_EVERY_MS;
      if (started !== null && currentVersion(places.installRoot) === started.version) this.started = null;
      return null;
    }
    if (started === null) return (await this.begun(places, planned.closure)) ? null : 'stood';
    this.started = null;
    if (currentVersion(places.installRoot) !== started.version) return 'again';
    const fell = fallen(places.installRoot);
    if (fell?.fell === 'unrestored') {
      this.stand({ why: 'unrestored', build: fell.build, said: fell.said, detail: fell.detail });
      return 'stood';
    }
    this.stand({ why: 'not-started', detail: `${CHANNEL.name} ${ended}`, startup: await startupLeft(places.data) });
    return 'stood';
  }

  private async begun(places: Places, closure: Closure): Promise<boolean> {
    const holder = await activeElsewhere(this.opening.env);
    if (holder !== null) {
      this.held = closure;
      this.stand({ why: 'channel-active', holder });
      return false;
    }
    const source = transferable(this.opening.env);
    if (source !== null && (await this.window.offer(source))) {
      this.stand({ why: 'transferring', from: source.name });
      const refused = await transferFrom(closure, source, places.log, this.opening.env);
      if (refused !== null) {
        this.stand({ why: 'unknown', detail: `the data of ${source.name} was not carried: ${refused}` });
        return false;
      }
    }
    if (this.left) return false;
    console.log(`[tagma-desktop] starting ${join(closure.root, 'bin')} serve; its log is ${places.log}`);
    const version = currentVersion(places.installRoot);
    this.started = { handle: await startServer(closure, places.log, this.opening.env), version };
    return true;
  }
}
