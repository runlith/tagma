/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { Notice } from '@tagma/server/push/contract/wire/push';
import { RESOURCE_PREFIXES } from '@tagma/server/http/contract/wire/served';
import { version } from '$service-worker';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

const CACHE = `tagma-shell-${version}`;
const SHELL = '/';
const IMMUTABLE = '/_app/immutable/';
const PASSING = [...RESOURCE_PREFIXES, '/health', '/_app/version.json'];
const NAVIGATION_MS = 4_000;
const ICON = '/icon-192.png';

worker.addEventListener('install', () => void worker.skipWaiting());

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== worker.location.origin) return;
  if (passing(url.pathname)) return;
  if (request.mode === 'navigate') event.respondWith(navigate(event));
  else if (url.pathname.startsWith(IMMUTABLE)) event.respondWith(immutable(request));
});

function passing(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const routed = path.toLowerCase().replace(/\/+/gu, '/');
  return PASSING.some((passed) => routed === passed || routed.startsWith(passed));
}

async function navigate(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(CACHE);
  event.waitUntil(
    fetch(SHELL).then(
      (shell) => (shell.ok ? cache.put(SHELL, shell) : undefined),
      () => undefined,
    ),
  );
  const fetched = fetch(event.request);
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), NAVIGATION_MS));
  const first = await Promise.race([fetched.catch(() => null), late]);
  if (first !== null) return first;
  return (await cache.match(SHELL)) ?? fetched;
}

async function immutable(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const held = await cache.match(request);
  if (held !== undefined) return held;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

worker.addEventListener('push', (event) => {
  const notice = event.data?.json() as Notice | undefined;
  if (notice === undefined) return;
  const options: NotificationOptions & { renotify: boolean } = {
    body: notice.body,
    tag: notice.tag,
    renotify: true,
    icon: ICON,
    data: { url: notice.url },
  };
  event.waitUntil(
    Promise.all([
      worker.registration.showNotification(notice.title, options),
      'setAppBadge' in worker.navigator ? worker.navigator.setAppBadge(notice.badge) : undefined,
    ]),
  );
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url ?? '/';
  event.waitUntil(
    (async () => {
      const open = (await worker.clients.matchAll({ type: 'window', includeUncontrolled: true }))[0];
      if (open === undefined) {
        await worker.clients.openWindow(url);
        return;
      }
      open.postMessage({ type: 'tagma.open', url });
      await open.focus();
    })(),
  );
});
