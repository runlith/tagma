import type { CookieDeleteOptions, CookieOptions } from './cookies.js';
import { Service } from './key.js';

export interface PlatformStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(prefix: string): readonly string[];
  watch(key: string, listener: (value: string | null) => void): () => void;
}

export interface PlatformCookies {
  get(name: string): string | undefined;
  all(): Record<string, string>;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string, options?: CookieDeleteOptions): void;
}

export type PlatformFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type PlatformSocket = (url: string, protocols?: string | string[]) => WebSocket;

export type PlatformKind = 'browser' | 'server';

export interface PlatformOptions {
  readonly kind?: PlatformKind;
  readonly fetch?: PlatformFetch;
  readonly socket?: PlatformSocket;
  readonly databases?: IDBFactory;
  readonly locks?: LockManager | null;
  readonly languages?: readonly string[];
  readonly userAgent?: string;
}

export interface ServerPlatformOptions extends PlatformOptions {
  readonly cookies?: PlatformCookies;
}

export class Platform extends Service<Platform>()('Platform', { tier: 'app' }) {
  constructor(
    readonly storage: { readonly local: PlatformStorage; readonly session: PlatformStorage },
    readonly cookies: PlatformCookies,
    private readonly options: PlatformOptions = {},
  ) {
    super();
  }

  get kind(): PlatformKind {
    return this.options.kind ?? 'browser';
  }

  get isBrowser(): boolean {
    return this.kind === 'browser';
  }

  get fetch(): PlatformFetch {
    return this.options.fetch ?? ((input, init) => fetch(input, init));
  }

  get socket(): PlatformSocket {
    return this.options.socket ?? ((url, protocols) => new WebSocket(url, protocols));
  }

  get databases(): IDBFactory {
    return this.options.databases ?? indexedDB;
  }

  get locks(): LockManager | null {
    return this.options.locks === undefined ? (globalThis.navigator?.locks ?? null) : this.options.locks;
  }

  get languages(): readonly string[] {
    return this.options.languages ?? [];
  }

  get userAgent(): string | undefined {
    return this.options.userAgent;
  }
}

const inertStorage: PlatformStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  keys: () => [],
  watch: () => () => undefined,
};

const inertCookies: PlatformCookies = {
  get: () => undefined,
  all: () => ({}),
  set: () => undefined,
  delete: () => undefined,
};

export function serverPlatform(options: ServerPlatformOptions = {}): Platform {
  const { cookies = inertCookies, ...rest } = options;
  return new Platform({ local: inertStorage, session: inertStorage }, cookies, { kind: 'server', ...rest });
}
