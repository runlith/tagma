import type { PlatformStorage } from './Platform.js';

export class Mark {
  constructor(
    private readonly storage: PlatformStorage,
    readonly key: string,
    private readonly cooldownMs: number,
  ) {}

  static of(storage: PlatformStorage, key: string, options: { cooldownMs: number }): Mark {
    return new Mark(storage, key, options.cooldownMs);
  }

  get spentAtMs(): number | undefined {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  get readyAtMs(): number {
    return (this.spentAtMs ?? 0) + this.cooldownMs;
  }

  isReady(nowMs: number): boolean {
    return nowMs >= this.readyAtMs;
  }

  spend(nowMs: number): void {
    this.storage.setItem(this.key, String(nowMs));
  }

  reset(): void {
    this.storage.removeItem(this.key);
  }
}
