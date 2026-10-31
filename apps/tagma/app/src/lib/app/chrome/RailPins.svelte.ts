import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { launchNamed } from './place.js';

const STORAGE_KEY = 'tagma.rail';

type Stored = {
  readonly pinned: readonly string[];
  readonly unpinned: readonly string[];
};

const NOTHING: Stored = { pinned: [], unpinned: [] };

export class RailPins extends Service<RailPins>()('RailPins', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new RailPins(platform.storage.local, yield* SurfaceRegistry);
  }

  private stored = $state.raw<Stored>(NOTHING);
  private readonly arranged = $derived(this.arrange(this.stored));

  constructor(
    private readonly storage: PlatformStorage,
    private readonly surfaces: SurfaceRegistry,
  ) {
    super();
    this.stored = this.read();
    $effect(() => storage.watch(STORAGE_KEY, () => (this.stored = this.read())));
  }

  private get daily(): readonly string[] {
    return this.surfaces.rail.filter((entry) => entry.pinned === true).map((entry) => entry.surface);
  }

  get ids(): readonly string[] {
    return this.arranged;
  }

  pin(id: string, before: string | null): void {
    const stored = this.read();
    const pinned = this.arrange(stored).filter((one) => one !== id);
    const at = before === null ? -1 : pinned.indexOf(before);
    pinned.splice(at === -1 ? pinned.length : at, 0, id);
    this.write({ pinned, unpinned: stored.unpinned.filter((one) => one !== id) });
  }

  unpin(id: string): void {
    const stored = this.read();
    const unpinned = this.daily.includes(id) && !stored.unpinned.includes(id) ? [...stored.unpinned, id] : stored.unpinned;
    this.write({ pinned: this.arrange(stored).filter((one) => one !== id), unpinned });
  }

  private arrange(stored: Stored): string[] {
    const fresh = this.daily.filter((id) => !stored.pinned.includes(id) && !stored.unpinned.includes(id));
    return [...stored.pinned, ...fresh];
  }

  private read(): Stored {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return NOTHING;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) return NOTHING;
      throw error;
    }
    if (typeof parsed !== 'object' || parsed === null) return NOTHING;
    const document = parsed as Record<string, unknown>;
    return { pinned: this.names(document.pinned), unpinned: this.names(document.unpinned) };
  }

  private names(value: unknown): readonly string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((one): one is string => typeof one === 'string').map((one) => launchNamed(this.surfaces.named(one))))];
  }

  private write(next: Stored): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.stored = next;
  }
}
