import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import type { SeamPane } from '@runlith/seam/Seam.svelte';
import { SvelteMap } from 'svelte/reactivity';

const SIZES_KEY = 'tagma.panes';

export type SeamGeometry = { readonly key: string; readonly pane: SeamPane };

export class Seams extends Service<Seams>()('Seams', { tier: 'app' }) {
  static *make() {
    const seams = new Seams((yield* Platform).storage.local);
    (yield* Scope).defer(() => seams.release());
    return seams;
  }

  private readonly sizes = new SvelteMap<string, number>();

  private readonly unwatch: () => void;

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.absorb(storage.getItem(SIZES_KEY));
    this.unwatch = storage.watch(SIZES_KEY, (value) => this.absorb(value));
  }

  size(geometry: SeamGeometry, place?: number): number | undefined {
    return this.sizes.get(keyOf(geometry, place));
  }

  seam(geometry: SeamGeometry, place?: number): SeamPane {
    const kept = this.size(geometry, place);
    return kept === undefined ? geometry.pane : { ...geometry.pane, size: kept };
  }

  set(geometry: SeamGeometry, size: number, place?: number): void {
    const key = keyOf(geometry, place);
    const rounded = Math.round(size);
    if (this.sizes.get(key) === rounded) return;
    this.sizes.set(key, rounded);
    const document = { ...Object.fromEntries(stored(this.storage.getItem(SIZES_KEY))), [key]: rounded };
    this.storage.setItem(SIZES_KEY, JSON.stringify(document));
  }

  release(): void {
    this.unwatch();
  }

  private absorb(raw: string | null): void {
    for (const [key, size] of stored(raw)) if (this.sizes.get(key) !== size) this.sizes.set(key, size);
  }
}

function stored(raw: string | null): [string, number][] {
  try {
    const document = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    return Object.entries(document ?? {}).flatMap(([key, size]) =>
      typeof size === 'number' && Number.isFinite(size) && size > 0 ? [[key, size] as [string, number]] : [],
    );
  } catch {
    return [];
  }
}

const keyOf = (geometry: SeamGeometry, place: number | undefined): string =>
  place === undefined ? geometry.key : `${geometry.key}:${place}`;
