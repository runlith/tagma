import { Service } from '@runlith/layer/key';
import type { Snippet } from 'svelte';
import { Claims } from '$lib/shared/Claims.svelte.js';

export class Bar extends Service<Bar>()('Bar', { tier: 'app' }) {
  static make(): Bar {
    return new Bar();
  }

  private readonly zones = new Claims<Snippet>();

  private readonly names = new Claims<() => string | null>();

  get zone(): Snippet | null {
    return this.zones.current;
  }

  get title(): string | null {
    return this.names.current?.() ?? null;
  }

  hold(zone: Snippet): () => void {
    return this.zones.take(zone);
  }

  name(read: () => string | null): () => void {
    return this.names.take(read);
  }
}
