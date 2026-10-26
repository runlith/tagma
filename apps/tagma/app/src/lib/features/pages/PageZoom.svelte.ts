import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { ZOOMS } from '$lib/features/browser/zoom.js';

const ZOOMS_KEY = 'tagma.pageZoom';

const KEPT = 100;

export class PageZoom extends Service<PageZoom>()('PageZoom', { tier: 'app' }) {
  static *make() {
    const zooms = new PageZoom((yield* Platform).storage.local);
    (yield* Scope).defer(() => zooms.release());
    return zooms;
  }

  private readonly zooms = new SvelteMap<string, number>();

  private readonly unwatch: () => void;

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.absorb(storage.getItem(ZOOMS_KEY));
    this.unwatch = storage.watch(ZOOMS_KEY, (value) => this.absorb(value));
  }

  zoom(page: string): number {
    return this.zooms.get(page) ?? 1;
  }

  set(page: string, factor: number): void {
    if (this.zoom(page) === factor) return;
    this.zooms.delete(page);
    if (factor !== 1) this.zooms.set(page, factor);
    const kept = [...this.zooms].slice(-KEPT);
    this.storage.setItem(ZOOMS_KEY, JSON.stringify(Object.fromEntries(kept)));
  }

  release(): void {
    this.unwatch();
  }

  private absorb(raw: string | null): void {
    const read = stored(raw);
    for (const page of [...this.zooms.keys()]) if (!read.has(page)) this.zooms.delete(page);
    for (const [page, factor] of read) if (this.zooms.get(page) !== factor) this.zooms.set(page, factor);
  }
}

function stored(raw: string | null): ReadonlyMap<string, number> {
  try {
    const document = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    return new Map(
      Object.entries(document ?? {}).flatMap(([page, factor]) =>
        typeof factor === 'number' && (ZOOMS as readonly number[]).includes(factor) ? [[page, factor] as [string, number]] : [],
      ),
    );
  } catch {
    return new Map();
  }
}
