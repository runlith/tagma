import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Download } from '@tagma/server/browser/contract/wire/page';
import { app, type BaseWindow, type DownloadItem, dialog, type Session, session, systemPreferences, type WebContents } from 'electron';
import { firefoxAgent, isGoogleSignIn } from './identity.js';

const GRANTED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

export const partitionOf = (profile: string): string => `persist:browser-${profile}`;

export type PageOwner = {
  readonly downloaded: (contents: WebContents, download: Download) => void;
  readonly window: (contents: WebContents) => BaseWindow | null;
};

type Device = 'microphone' | 'camera';

const DEVICE_WORDS: Record<Device, string> = { microphone: 'your microphone', camera: 'your camera' };

const freePath = (folder: string, name: string): string => {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length) || 'download';
  let candidate = join(folder, `${stem}${extension}`);
  for (let index = 1; existsSync(candidate); index += 1) candidate = join(folder, `${stem} (${index})${extension}`);
  return candidate;
};

const devicesOf = (types: readonly string[]): readonly Device[] | null => {
  if (types.length === 0 || types.some((type) => type !== 'audio' && type !== 'video')) return null;
  return [...new Set(types.map((type): Device => (type === 'audio' ? 'microphone' : 'camera')))];
};

const systemGranted = async (devices: readonly Device[]): Promise<boolean> => {
  if (process.platform !== 'darwin') return true;
  for (const device of devices) {
    if (systemPreferences.getMediaAccessStatus(device) === 'granted') continue;
    if (!(await systemPreferences.askForMediaAccess(device))) return false;
  }
  return true;
};

export class Profiles {
  private readonly prepared = new Set<string>();
  private readonly decided = new Map<string, boolean>();

  constructor(
    private readonly identity: 'cleaned' | 'native',
    private readonly owner: PageOwner,
  ) {}

  session(profile: string): Session {
    const held = session.fromPartition(partitionOf(profile));
    if (!this.prepared.has(profile)) this.prepare(held, profile);
    return held;
  }

  async clear(profile: string): Promise<void> {
    const held = this.session(profile);
    await held.clearStorageData();
    await held.clearCache();
    await held.clearAuthCache();
  }

  private prepare(held: Session, profile: string): void {
    this.prepared.add(profile);
    held.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission !== 'media') {
        callback(GRANTED.has(permission));
        return;
      }
      const devices = devicesOf('mediaTypes' in details ? (details.mediaTypes ?? []) : []);
      const origin = URL.canParse(details.requestingUrl) ? new URL(details.requestingUrl).origin : null;
      if (devices === null || origin === null) {
        callback(false);
        return;
      }
      this.mediaAllowed(profile, contents, origin, devices).then(callback, (error: unknown) => {
        console.warn(`[tagma-desktop] media access for ${origin} was not asked: ${String(error)}`);
        callback(false);
      });
    });
    held.setPermissionCheckHandler((contents, permission, origin, details) => {
      if (permission !== 'media') return GRANTED.has(permission);
      const type = details.mediaType;
      if ((type !== 'audio' && type !== 'video') || this.seen(contents) === null) return false;
      return this.decided.get(this.decision(profile, origin, type === 'audio' ? 'microphone' : 'camera')) === true;
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

  private seen(contents: WebContents | null): BaseWindow | null {
    const window = contents === null ? null : this.owner.window(contents);
    return window !== null && !window.isDestroyed() && window.isVisible() && !window.isMinimized() ? window : null;
  }

  private decision(profile: string, origin: string, device: Device): string {
    return `${profile} ${origin} ${device}`;
  }

  private async mediaAllowed(profile: string, contents: WebContents, origin: string, devices: readonly Device[]): Promise<boolean> {
    const window = this.seen(contents);
    if (window === null) return false;
    const asked = devices.filter((device) => !this.decided.has(this.decision(profile, origin, device)));
    if (asked.length > 0) {
      const { response } = await dialog.showMessageBox(window, {
        message: `${origin} wants to use ${asked.map((device) => DEVICE_WORDS[device]).join(' and ')}`,
        buttons: ['Allow', 'Block'],
        defaultId: 1,
        cancelId: 1,
      });
      for (const device of asked) this.decided.set(this.decision(profile, origin, device), response === 0);
    }
    if (!devices.every((device) => this.decided.get(this.decision(profile, origin, device)) === true)) return false;
    return systemGranted(devices);
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
