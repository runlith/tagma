import {
  type BaseWindow,
  dialog,
  type MediaAccessPermissionRequest,
  type PermissionRequest,
  type Session,
  systemPreferences,
  type WebContents,
} from 'electron';

type Device = 'microphone' | 'camera';

const DEVICE_WORDS: Record<Device, string> = { microphone: 'your microphone', camera: 'your camera' };

const WINDOW_SCOPE = 'window';

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

export class MediaGrants {
  private readonly decided = new Map<string, boolean>();

  constructor(private readonly windowOf: (contents: WebContents) => BaseWindow | null) {}

  request(scope: string, contents: WebContents, details: PermissionRequest | MediaAccessPermissionRequest): Promise<boolean> {
    const devices = devicesOf('mediaTypes' in details ? (details.mediaTypes ?? []) : []);
    const origin = URL.canParse(details.requestingUrl) ? new URL(details.requestingUrl).origin : null;
    if (devices === null || origin === null) return Promise.resolve(false);
    return this.allowed(scope, contents, origin, devices).catch((error: unknown) => {
      console.warn(`[tagma-desktop] media access for ${origin} was not asked: ${String(error)}`);
      return false;
    });
  }

  check(scope: string, contents: WebContents | null, origin: string, type: string | undefined): boolean {
    if ((type !== 'audio' && type !== 'video') || this.seen(contents) === null) return false;
    return this.decided.get(this.decision(scope, origin, type === 'audio' ? 'microphone' : 'camera')) === true;
  }

  guardFrames(held: Session): void {
    held.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission !== 'media' || details.isMainFrame) {
        callback(true);
        return;
      }
      void this.request(WINDOW_SCOPE, contents, details).then(callback);
    });
    held.setPermissionCheckHandler((contents, permission, origin, details) => {
      if (permission !== 'media' || details.isMainFrame) return true;
      return this.check(WINDOW_SCOPE, contents, origin, details.mediaType);
    });
  }

  private seen(contents: WebContents | null): BaseWindow | null {
    const window = contents === null ? null : this.windowOf(contents);
    return window !== null && !window.isDestroyed() && window.isVisible() && !window.isMinimized() ? window : null;
  }

  private decision(scope: string, origin: string, device: Device): string {
    return `${scope} ${origin} ${device}`;
  }

  private async allowed(scope: string, contents: WebContents, origin: string, devices: readonly Device[]): Promise<boolean> {
    const window = this.seen(contents);
    if (window === null) return false;
    const asked = devices.filter((device) => !this.decided.has(this.decision(scope, origin, device)));
    if (asked.length > 0) {
      const { response } = await dialog.showMessageBox(window, {
        message: `${origin} wants to use ${asked.map((device) => DEVICE_WORDS[device]).join(' and ')}`,
        buttons: ['Allow', 'Block'],
        defaultId: 1,
        cancelId: 1,
      });
      for (const device of asked) this.decided.set(this.decision(scope, origin, device), response === 0);
    }
    if (!devices.every((device) => this.decided.get(this.decision(scope, origin, device)) === true)) return false;
    return systemGranted(devices);
  }
}
