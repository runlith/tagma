import type { WebLifetimes, WebMemory } from './vendorWeb';

const SWEEP_MS = 60_000;
const DOMAINS = 4096;

type Kept = { readonly content: string; readonly expires: number };

export class WebCache {
  private readonly domains = new Map<string, number>();
  private readonly pages = new Map<string, Kept>();
  private held = 0;
  private swept: number;

  constructor(
    private readonly characters: number,
    private readonly now: () => number = Date.now,
  ) {
    this.swept = now();
  }

  view(scope: string, lifetimes: WebLifetimes): WebMemory {
    const key = (url: string) => `${scope}\u0000${url}`;
    return {
      page: (url) => this.page(key(url)),
      keep: (url, content) => this.keep(key(url), content, lifetimes.pageMs),
      allowed: (host) => this.allowed(host),
      allow: (host) => this.allow(host, lifetimes.domainMs),
    };
  }

  private allowed(host: string): boolean {
    const expires = this.domains.get(host);
    if (expires === undefined) return false;
    if (expires > this.now()) return true;
    this.domains.delete(host);
    return false;
  }

  private allow(host: string, lifetimeMs: number): void {
    this.domains.delete(host);
    this.domains.set(host, this.now() + lifetimeMs);
    for (const oldest of this.domains.keys()) {
      if (this.domains.size <= DOMAINS) break;
      this.domains.delete(oldest);
    }
  }

  private page(key: string): string | undefined {
    const found = this.pages.get(key);
    if (found === undefined) return undefined;
    if (found.expires <= this.now()) {
      this.forget(key);
      return undefined;
    }
    this.pages.delete(key);
    this.pages.set(key, found);
    return found.content;
  }

  private keep(key: string, content: string, lifetimeMs: number): void {
    this.forget(key);
    if (content.length > this.characters) return;
    const now = this.now();
    this.sweep(now);
    this.pages.set(key, { content, expires: now + lifetimeMs });
    this.held += content.length;
    for (const oldest of this.pages.keys()) {
      if (this.held <= this.characters) break;
      this.forget(oldest);
    }
  }

  private sweep(now: number): void {
    if (now - this.swept < SWEEP_MS) return;
    this.swept = now;
    for (const [key, kept] of this.pages) if (kept.expires <= now) this.forget(key);
    for (const [host, expires] of this.domains) if (expires <= now) this.domains.delete(host);
  }

  private forget(key: string): void {
    const found = this.pages.get(key);
    if (found === undefined) return;
    this.held -= found.content.length;
    this.pages.delete(key);
  }
}
