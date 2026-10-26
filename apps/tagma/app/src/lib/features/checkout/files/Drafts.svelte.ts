import type { PlatformStorage } from '@runlith/layer/Platform';
import { SvelteMap } from 'svelte/reactivity';

export type Draft = { readonly digest: string; readonly text: string };

export const DRAFTS_KEPT_CHARS = 1_000_000;

const INDEX = 'tagma.drafts';

const slot = (key: string): string => `tagma.draft:${key.replaceAll('\u0000', '|')}`;

export class Drafts {
  private readonly sizes = new SvelteMap<string, number>();

  constructor(private readonly storage: PlatformStorage) {
    try {
      const stored = JSON.parse(storage.getItem(INDEX) ?? '{}') as Record<string, unknown>;
      for (const [key, size] of Object.entries(stored)) if (typeof size === 'number') this.sizes.set(key, size);
    } catch {
      this.sizes.clear();
    }
  }

  has(key: string): boolean {
    return this.sizes.has(key);
  }

  get(key: string): Draft | null {
    if (!this.sizes.has(key)) return null;
    try {
      const parsed = JSON.parse(this.storage.getItem(slot(key)) ?? 'null') as Partial<Draft> | null;
      return typeof parsed?.text === 'string' && typeof parsed.digest === 'string' ? { digest: parsed.digest, text: parsed.text } : null;
    } catch {
      return null;
    }
  }

  put(key: string, draft: Draft): boolean {
    const size = draft.text.length + draft.digest.length;
    let others = 0;
    for (const [other, chars] of this.sizes) if (other !== key) others += chars;
    if (others + size > DRAFTS_KEPT_CHARS) {
      this.drop(key);
      return false;
    }
    try {
      this.storage.setItem(slot(key), JSON.stringify(draft));
    } catch {
      this.drop(key);
      return false;
    }
    this.sizes.set(key, size);
    this.save();
    return true;
  }

  drop(key: string): void {
    if (!this.sizes.delete(key)) return;
    this.storage.removeItem(slot(key));
    this.save();
  }

  private save(): void {
    this.storage.setItem(INDEX, JSON.stringify(Object.fromEntries(this.sizes)));
  }
}
