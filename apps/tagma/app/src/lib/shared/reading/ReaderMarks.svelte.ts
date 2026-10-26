import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';

export class KeptRecord<V> {
  private readonly entries = new SvelteMap<string, V>();

  constructor(
    private readonly storage: PlatformStorage,
    private readonly at: string,
    private readonly forward: (key: string) => string = (key) => key,
  ) {
    for (const [key, value] of this.stored()) this.entries.set(key, value);
  }

  get(key: string): V | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: V): void {
    this.entries.set(key, value);
    const document = Object.fromEntries(this.entries);
    for (const [stored, kept] of this.stored()) document[stored] = kept;
    document[key] = value;
    this.storage.setItem(this.at, JSON.stringify(document));
  }

  private stored(): [string, V][] {
    try {
      const stored = JSON.parse(this.storage.getItem(this.at) ?? 'null') as Record<string, V> | null;
      return stored ? Object.entries(stored).map(([key, value]) => [this.forward(key), value]) : [];
    } catch {
      return [];
    }
  }
}

export class ReaderMarks extends Service<ReaderMarks>()('ReaderMarks', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new ReaderMarks(platform.storage.local);
  }

  readonly seen: KeptRecord<string>;
  readonly trail: KeptRecord<string[]>;
  readonly journal: KeptRecord<number>;
  readonly bases: KeptRecord<string>;
  readonly foldedSides: KeptRecord<string>;
  readonly grouping: KeptRecord<string>;
  readonly widths: KeptRecord<string>;
  readonly wraps: KeptRecord<boolean>;
  readonly threadFolds: KeptRecord<string[]>;
  readonly openThreadStubs: KeptRecord<string[]>;
  readonly pinnedBandFolded: KeptRecord<boolean>;
  readonly agentsView: KeptRecord<string>;
  readonly worktreeFolds: KeptRecord<string[]>;
  readonly declinedOffers: KeptRecord<boolean>;

  constructor(storage: PlatformStorage) {
    super();
    this.seen = new KeptRecord(storage, 'tagma.readAt', (key) => (key.includes('\t') ? key : `\t${key}`));
    this.trail = new KeptRecord(storage, 'tagma.visited');
    this.journal = new KeptRecord(storage, 'tagma.journalSeen', (key) => (key.includes(':') ? key : `${key}:`));
    this.bases = new KeptRecord(storage, 'tagma.compareBase');
    this.foldedSides = new KeptRecord(storage, 'tagma.foldedSides');
    this.grouping = new KeptRecord(storage, 'tagma.pathGrouping');
    this.widths = new KeptRecord(storage, 'tagma.diffWidth');
    this.wraps = new KeptRecord(storage, 'tagma.diffWrap');
    this.threadFolds = new KeptRecord(storage, 'tagma.threadFolds');
    this.openThreadStubs = new KeptRecord(storage, 'tagma.openThreadStubs');
    this.pinnedBandFolded = new KeptRecord(storage, 'tagma.pinnedBandFolded');
    this.agentsView = new KeptRecord(storage, 'tagma.agentsView');
    this.worktreeFolds = new KeptRecord(storage, 'tagma.worktreeFolds');
    this.declinedOffers = new KeptRecord(storage, 'tagma.declinedOffers');
  }
}
