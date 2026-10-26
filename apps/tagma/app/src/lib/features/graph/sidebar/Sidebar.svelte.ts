import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { SvelteSet } from 'svelte/reactivity';

const OPEN_KEY = 'tagma.knowledgeColumn';
const SHELVES_KEY = 'tagma.sidebarShelves';

export class Sidebar extends Service<Sidebar>()('Sidebar', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new Sidebar(platform.storage.local);
  }

  open = $state(true);
  private readonly shelves = new SvelteSet<string>();

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.open = storage.getItem(OPEN_KEY) !== 'false';
    for (const heading of readList(storage, SHELVES_KEY) ?? []) this.shelves.add(heading);
  }

  toggle(): void {
    this.open = !this.open;
    this.storage.setItem(OPEN_KEY, String(this.open));
  }

  shelfOpen(heading: string): boolean {
    return !this.shelves.has(heading);
  }

  toggleShelf(heading: string): void {
    if (!this.shelves.delete(heading)) this.shelves.add(heading);
    this.storage.setItem(SHELVES_KEY, JSON.stringify([...this.shelves]));
  }
}

function readList(storage: PlatformStorage, key: string): string[] | null {
  try {
    const stored = JSON.parse(storage.getItem(key) ?? 'null') as unknown;
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : null;
  } catch {
    return null;
  }
}
