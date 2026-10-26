import type { Subscription } from '@tagma/server/push/contract/wire/push';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ServiceWorkers, type WorkerPort } from '$lib/shared/workers/ServiceWorkers.js';
import { Door } from '$lib/wire/Door.js';

const CARD_GONE = 'tagma.push.offered';
const OPEN_MESSAGE = 'tagma.open';

type Reading = {
  readonly key: string | null;
  readonly device: string | null;
  readonly endpoint: string | null;
  readonly problem: string | null;
  readonly devices: readonly string[];
};

export class Push extends Service<Push>()('Push', { tier: 'app' }) {
  static *make() {
    return new Push(yield* Door, yield* ServiceWorkers, (yield* Platform).storage.local, yield* Router, yield* Scope);
  }

  reading = $state.raw<Reading | null>(null);
  on = $state(false);
  busy = $state(false);
  problem = $state<string | null>(null);
  private cardGone = $state(true);

  constructor(
    private readonly door: Door,
    private readonly workers: WorkerPort,
    private readonly storage: PlatformStorage,
    router: Router,
    scope: Scope,
  ) {
    super();
    if (!workers.pushable) return;
    this.cardGone = storage.getItem(CARD_GONE) !== null;
    scope.defer(
      workers.onMessage((message) => {
        const data = message as { type?: unknown; url?: unknown } | null;
        if (data?.type === OPEN_MESSAGE && typeof data.url === 'string') void router.goto(data.url);
      }),
    );
    void this.reconcile();
  }

  get offered(): boolean {
    const reading = this.reading;
    return (
      !this.cardGone &&
      !this.on &&
      reading !== null &&
      reading.device !== null &&
      reading.key !== null &&
      this.workers.permission() !== 'denied'
    );
  }

  dismiss(): void {
    this.storage.setItem(CARD_GONE, new Date().toISOString());
    this.cardGone = true;
  }

  async turnOn(): Promise<void> {
    const key = this.reading?.key ?? null;
    if (key === null || this.busy) return;
    this.busy = true;
    this.problem = null;
    try {
      const permission = await this.workers.askPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') this.dismiss();
        return;
      }
      await this.publish(await this.workers.subscribe(key));
      this.dismiss();
    } catch (caught) {
      this.problem = caught instanceof Error ? caught.message : String(caught);
    } finally {
      this.busy = false;
    }
  }

  async settle(waiting: ReadonlySet<string>, badge: number): Promise<void> {
    if (!this.workers.pushable) return;
    for (const notice of await this.workers.notices()) if (!waiting.has(notice.tag)) notice.close();
    await this.workers.badge(badge);
  }

  async seen(threadId: string): Promise<void> {
    if (!this.workers.pushable) return;
    for (const notice of await this.workers.notices(threadId)) notice.close();
  }

  private async reconcile(): Promise<void> {
    try {
      const { status: _, ...reading } = await this.door.perform('read_push_status', {}, {});
      this.reading = reading;
      if (reading.device === null) return;
      const held = await this.workers.subscription();
      if (held === null) {
        this.on = false;
        if (reading.endpoint !== null) await this.door.perform('unsubscribe_push', {}, {});
        return;
      }
      if (held.endpoint !== reading.endpoint) await this.publish(held);
      else this.on = true;
    } catch (caught) {
      this.problem = caught instanceof Error ? caught.message : String(caught);
    }
  }

  private async publish(wire: Subscription): Promise<void> {
    await this.door.perform('subscribe_push', wire, {});
    this.on = true;
    const reading = this.reading;
    if (reading?.device == null) return;
    const devices = reading.devices.includes(reading.device) ? reading.devices : [...reading.devices, reading.device];
    this.reading = { ...reading, endpoint: wire.endpoint, devices };
  }
}
