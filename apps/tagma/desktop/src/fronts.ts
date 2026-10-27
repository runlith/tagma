import type { BrowserWindow } from 'electron';
import type { SurfaceKind, SurfaceRefusal } from './bridge.js';

export interface DevPort {
  start(): Promise<URL | SurfaceRefusal>;
  badge(window: BrowserWindow, built: () => void): () => void;
  fell(window: BrowserWindow, reason: string): void;
  leave(window: BrowserWindow): boolean;
  moved(): void;
}

export const rebased = (place: URL, onto: URL): URL => new URL(`${place.pathname}${place.search}`, onto);

const originOf = (url: string | undefined): string | null => (url !== undefined && URL.canParse(url) ? new URL(url).origin : null);

export class Fronts {
  private dev: URL | null = null;
  private readonly standing = new Set<object>();

  constructor(readonly built: URL) {}

  adopt(dev: URL): void {
    this.dev = dev;
  }

  stand(holder: object, kind: SurfaceKind): void {
    if (kind === 'dev') this.standing.add(holder);
    else this.standing.delete(holder);
  }

  get onDev(): boolean {
    return this.standing.size > 0;
  }

  get devAddress(): URL | null {
    return this.onDev ? this.dev : null;
  }

  origins(): readonly string[] {
    const dev = this.devAddress;
    return dev === null ? [this.built.origin] : [this.built.origin, dev.origin];
  }

  trusts(sender: string | undefined): boolean {
    const origin = originOf(sender);
    return origin !== null && this.origins().includes(origin);
  }

  fromDev(url: string): boolean {
    const dev = this.devAddress;
    return dev !== null && originOf(url) === dev.origin;
  }

  placed(url: string): URL | null {
    return this.trusts(url) ? rebased(new URL(url), this.built) : null;
  }
}
