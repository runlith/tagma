import { SvelteSet } from 'svelte/reactivity';

export class Gone {
  private readonly keys = new SvelteSet<string>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  mark(key: string): void {
    this.keys.add(key);
  }

  clear(key: string): void {
    this.keys.delete(key);
  }

  remap(rename: (key: string) => string): void {
    for (const key of [...this.keys]) {
      const next = rename(key);
      if (next === key) continue;
      this.keys.delete(key);
      this.keys.add(next);
    }
  }
}
