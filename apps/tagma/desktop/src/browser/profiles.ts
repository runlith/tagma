import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Download } from '@tagma/server/browser/contract/wire/page';
import { app, type BaseWindow, type DownloadItem, type Session, session, type WebContents, webContents } from 'electron';
import { MediaGrants } from '../mediaGrants.js';
import { firefoxAgent, isGoogleSignIn } from './identity.js';

const GRANTED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

export const partitionOf = (profile: string): string => `persist:browser-${profile}`;

export type PageOwner = {
  readonly downloaded: (contents: WebContents, download: Download) => void;
  readonly window: (contents: WebContents) => BaseWindow | null;
};

type NavigationGuard = (url: string) => boolean;

type GuardedPage = { readonly session: Session; readonly id: number };

const freePath = (folder: string, name: string): string => {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length) || 'download';
  let candidate = join(folder, `${stem}${extension}`);
  for (let index = 1; existsSync(candidate); index += 1) candidate = join(folder, `${stem} (${index})${extension}`);
  return candidate;
};

export class Profiles {
  private readonly prepared = new Set<string>();
  private readonly media: MediaGrants;
  private readonly guarded = new Map<Session, Map<number, NavigationGuard>>();
  private readonly guardedPages = new WeakMap<WebContents, GuardedPage>();
  private readonly geolocations = new WeakMap<WebContents, number>();

  constructor(
    private readonly identity: 'cleaned' | 'native',
    private readonly owner: PageOwner,
  ) {
    this.media = new MediaGrants((contents) => owner.window(contents));
  }

  session(profile: string): Session {
    const held = session.fromPartition(partitionOf(profile));
    if (!this.prepared.has(profile)) this.prepare(held, profile);
    return held;
  }

  restricted(profile: string): boolean {
    return this.guarded.has(this.session(profile));
  }

  navigation(contents: WebContents, guard: NavigationGuard | null): void {
    if (guard === null) {
      const registered = this.guardedPages.get(contents);
      if (registered === undefined) return;
      this.guardedPages.delete(contents);
      const guards = this.guarded.get(registered.session);
      if (guards === undefined) return;
      guards.delete(registered.id);
      if (guards.size === 0) {
        registered.session.webRequest.onBeforeRequest(null);
        this.guarded.delete(registered.session);
      }
      return;
    }
    const held = contents.session;
    let guards = this.guarded.get(held);
    if (guards === undefined) {
      guards = new Map();
      this.guarded.set(held, guards);
      const active = guards;
      held.webRequest.onBeforeRequest((details, callback) => {
        if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
          callback({});
          return;
        }
        const id =
          details.webContents?.id ??
          (details.frame == null ? undefined : webContents.fromFrame(details.frame)?.id) ??
          details.webContentsId;
        callback({ cancel: id !== undefined && active.get(id)?.(details.url) === true });
      });
    }
    guards.set(contents.id, guard);
    this.guardedPages.set(contents, { session: held, id: contents.id });
  }

  async clear(profile: string): Promise<void> {
    const held = this.session(profile);
    await held.clearStorageData();
    await held.clearCache();
    await held.clearAuthCache();
  }

  geolocation(contents: WebContents): (() => void) | null {
    const url = contents.getURL();
    const origin = URL.canParse(url) ? new URL(url).origin : 'null';
    if (origin === 'null') return null;
    this.geolocations.set(contents, (this.geolocations.get(contents) ?? 0) + 1);
    return () => {
      const remaining = (this.geolocations.get(contents) ?? 1) - 1;
      if (remaining === 0) this.geolocations.delete(contents);
      else this.geolocations.set(contents, remaining);
    };
  }

  private locationAllowed(contents: WebContents | null, url: string): boolean {
    if (contents === null || (this.geolocations.get(contents) ?? 0) === 0 || !URL.canParse(url)) return false;
    const current = contents.getURL();
    const origin = URL.canParse(current) ? new URL(current).origin : 'null';
    return origin !== 'null' && origin === new URL(url).origin;
  }

  private prepare(held: Session, profile: string): void {
    this.prepared.add(profile);
    held.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission === 'geolocation') {
        callback(this.locationAllowed(contents, details.requestingUrl));
        return;
      }
      if (permission !== 'media') {
        callback(GRANTED.has(permission));
        return;
      }
      void this.media.request(partitionOf(profile), contents, details).then(callback);
    });
    held.setPermissionCheckHandler((contents, permission, origin, details) => {
      if (permission === 'geolocation') return this.locationAllowed(contents, origin);
      if (permission !== 'media') return GRANTED.has(permission);
      return this.media.check(partitionOf(profile), contents, origin, details.mediaType);
    });
    held.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    held.on('will-download', (_event, item, contents) => this.download(item, contents));
    if (this.identity === 'cleaned') {
      const firefox = firefoxAgent();
      held.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        const google = isGoogleSignIn(details.url);
        if (
          !google &&
          (details.resourceType !== 'mainFrame' ||
            !Object.entries(details.requestHeaders).some(([key, value]) => key.toLowerCase() === 'user-agent' && value === firefox))
        ) {
          callback({});
          return;
        }
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(details.requestHeaders)) {
          const lower = key.toLowerCase();
          if (lower === 'user-agent' || (google && lower.startsWith('sec-ch-ua'))) continue;
          headers[key] = value;
        }
        headers['User-Agent'] = google ? firefox : held.getUserAgent();
        callback({ requestHeaders: headers });
      });
    }
  }

  private download(item: DownloadItem, contents: WebContents): void {
    const path = freePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(path);
    const id = randomUUID();
    const at = new Date().toISOString();
    const report = (state: Download['state']) =>
      this.owner.downloaded(contents, { id, name: item.getFilename(), path, bytes: item.getReceivedBytes() || null, state, at });
    report('running');
    item.once('done', (_event, state) => report(state === 'completed' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed'));
  }
}
