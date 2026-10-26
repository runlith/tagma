import type { Subscription } from '@tagma/server/push/contract/wire/push';
import type { Permission, WorkerNotice, WorkerPort } from './ServiceWorkers.js';

const keyBytes = (key: string): Uint8Array<ArrayBuffer> => {
  const text = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
};

const wired = (subscription: PushSubscription): Subscription => {
  const keys = subscription.toJSON().keys;
  if (keys?.p256dh === undefined || keys.auth === undefined) throw new Error('The browser gave a push subscription without its keys.');
  return { endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth };
};

const SCRIPT = '/service-worker.js';

export class BrowserWorkers implements WorkerPort {
  constructor(private readonly type: WorkerType) {}

  get pushable(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async register(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    await navigator.serviceWorker.register(SCRIPT, { type: this.type });
  }

  async unregister(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    const workers = await navigator.serviceWorker.getRegistrations();
    await Promise.all(workers.map((worker) => worker.unregister()));
  }

  permission(): Permission {
    return Notification.permission;
  }

  askPermission(): Promise<Permission> {
    return Notification.requestPermission();
  }

  async subscription(): Promise<Subscription | null> {
    const held = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    return held === null ? null : wired(held);
  }

  async subscribe(key: string): Promise<Subscription> {
    const registration = await navigator.serviceWorker.ready;
    return wired(await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  }

  async notices(tag?: string): Promise<readonly WorkerNotice[]> {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration === undefined ? [] : registration.getNotifications(tag === undefined ? undefined : { tag });
  }

  async badge(count: number): Promise<void> {
    if (!('setAppBadge' in navigator)) return;
    await (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge());
  }

  onMessage(listener: (data: unknown) => void): () => void {
    if (!('serviceWorker' in navigator)) return () => undefined;
    const heard = (event: MessageEvent): void => listener(event.data);
    navigator.serviceWorker.addEventListener('message', heard);
    return () => navigator.serviceWorker.removeEventListener('message', heard);
  }
}
