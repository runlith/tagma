import { Platform } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { Door, KEEPALIVE_BYTES } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { AutoSave } from './AutoSave.svelte.js';
import { type DocumentPlace, documentKey, within } from './documentKey.js';
import { Differ } from './Differ.js';
import { Drafts } from './Drafts.svelte.js';
import { Gone } from './Gone.svelte.js';
import { Holders } from './Holders.svelte.js';
import { OpenedDocument } from './OpenedDocument.svelte.js';
import type { Trigger } from './Writes.svelte.js';

export type HeldDocument = { readonly document: OpenedDocument; release(): void };

export type Relocated = (place: DocumentPlace, from: string, to: string) => void;

export type Mark = 'pending' | 'refused';

export class Unsaved extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path} is not saved: ${reason}`);
    this.name = 'Unsaved';
  }
}

type Shared = { readonly document: OpenedDocument; readonly place: DocumentPlace; key: string; users: number };

export class Documents extends Service<Documents>()('Documents', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new Documents(yield* Live, yield* Door, yield* AutoSave, new Drafts(platform.storage.local), new Differ(), yield* Scope);
  }

  readonly gone = new Gone();

  private readonly open = new SvelteMap<string, Shared>();
  private readonly relocations = new Set<Relocated>();
  private readonly holders: Holders;

  constructor(
    private readonly live: LiveConnection,
    private readonly door: Door,
    private readonly autosave: AutoSave,
    private readonly drafts: Drafts,
    readonly differ: Differ,
    scope: Scope,
  ) {
    super();
    this.holders = new Holders(live);
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') void this.leave('hide', true);
    };
    const hiding = (): void => void this.leave('hide', true);
    const blurred = (): void => void this.leave('window');
    const warn = (event: BeforeUnloadEvent): void => {
      if (this.exposed()) event.preventDefault();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', hiding);
    window.addEventListener('blur', blurred);
    window.addEventListener('beforeunload', warn);
    scope.defer(() => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', hiding);
      window.removeEventListener('blur', blurred);
      window.removeEventListener('beforeunload', warn);
      for (const { document } of this.open.values()) document.close();
      this.open.clear();
      this.holders.close();
    });
  }

  get(place: DocumentPlace, path: string): OpenedDocument | undefined {
    return this.open.get(documentKey(place, path))?.document;
  }

  mark(place: DocumentPlace, path: string): Mark | null {
    const opened = this.get(place, path);
    if (opened === undefined) return this.drafts.has(documentKey(place, path)) ? 'pending' : null;
    if (opened.unwritable) return 'refused';
    return opened.unsettled ? 'pending' : null;
  }

  isGone(place: DocumentPlace, path: string): boolean {
    return this.gone.has(documentKey(place, path));
  }

  markGone(place: DocumentPlace, paths: readonly string[], on: boolean): void {
    for (const path of paths) {
      const key = documentKey(place, path);
      if (on) this.gone.mark(key);
      else this.gone.clear(key);
    }
  }

  onRelocated(listener: Relocated): () => void {
    this.relocations.add(listener);
    return () => this.relocations.delete(listener);
  }

  hold(place: DocumentPlace, path: string): HeldDocument {
    const key = documentKey(place, path);
    let shared = this.open.get(key);
    if (shared === undefined) {
      shared = this.make(place, path, key);
      this.open.set(key, shared);
    }
    shared.users += 1;
    const held = shared;
    let released = false;
    return {
      document: held.document,
      release: () => {
        if (released) return;
        released = true;
        held.users -= 1;
        this.retire(held);
      },
    };
  }

  leave(trigger: Trigger, keepalive = false): Promise<void> {
    return Promise.all([...this.open.values()].map((shared) => shared.document.leave(trigger, keepalive))).then(() => undefined);
  }

  unsettled(place: DocumentPlace, path: string): boolean {
    return this.under(place, path).some((shared) => shared.document.unsettled);
  }

  async flush(place: DocumentPlace, path: string): Promise<void> {
    await Promise.all(this.under(place, path).map((shared) => shared.document.flush()));
  }

  async settle(place: DocumentPlace, paths: readonly string[]): Promise<() => void> {
    const unique = [...new Set(paths.flatMap((path) => this.under(place, path)))];
    await Promise.all(unique.map((shared) => shared.document.flush()));
    for (const { document } of unique) {
      if (document.unsettled) {
        throw new Unsaved(document.path, document.saving.kind === 'refused' ? document.saving.reason : 'it conflicts with the disk');
      }
    }
    const releases = unique.map((shared) => shared.document.writes.hold());
    return () => {
      for (const release of releases) release();
    };
  }

  relocate(place: DocumentPlace, pairs: readonly { readonly from: string; readonly to: string }[]): void {
    for (const pair of pairs) {
      for (const shared of this.under(place, pair.from)) shared.document.relocate(pair.to + shared.document.path.slice(pair.from.length));
    }
    this.gone.remap((key) => {
      const [project, root, path] = key.split('\u0000') as [string, string, string];
      if (project !== String(place.projectId) || root !== place.rootId) return key;
      for (const pair of pairs) if (within(path, pair.from)) return documentKey(place, pair.to + path.slice(pair.from.length));
      return key;
    });
  }

  discard(place: DocumentPlace, path: string): void {
    for (const shared of this.under(place, path)) {
      shared.document.discardBuffer();
      this.retire(shared);
    }
  }

  abandon(place: DocumentPlace, path: string): void {
    for (const shared of this.under(place, path)) if (shared.users === 0) this.discardOrphan(shared);
  }

  private exposed(): boolean {
    for (const { document: opened, place } of this.open.values()) {
      if (!opened.unsettled) continue;
      opened.saveDraft();
      if (this.autosave.policyOf(place.projectId).mode === 'off' || opened.unwritable) return true;
      if (!opened.kept && opened.writes.payloadBytes() > KEEPALIVE_BYTES) return true;
    }
    return false;
  }

  private under(place: DocumentPlace, path: string): Shared[] {
    return [...this.open.values()].filter(
      (shared) => shared.place.projectId === place.projectId && shared.place.rootId === place.rootId && within(shared.document.path, path),
    );
  }

  private make(place: DocumentPlace, path: string, key: string): Shared {
    const opened = new OpenedDocument(
      this.live,
      this.door,
      place,
      path,
      () => this.autosave.policyOf(place.projectId),
      this.holders,
      this.drafts,
      this.gone,
      this.differ,
    );
    const shared: Shared = { document: opened, place, key, users: 0 };
    opened.listen((note) => {
      if (note.kind === 'rest') {
        this.retire(shared);
        return;
      }
      if (this.open.get(shared.key) === shared) this.open.delete(shared.key);
      shared.key = documentKey(place, note.to);
      this.open.set(shared.key, shared);
      for (const listener of this.relocations) listener(place, note.from, note.to);
    });
    return shared;
  }

  private discardOrphan(shared: Shared): void {
    shared.document.discardBuffer();
    shared.document.close();
    if (this.open.get(shared.key) === shared) this.open.delete(shared.key);
  }

  private retire(shared: Shared): void {
    if (shared.users > 0 || shared.document.unsettled) return;
    shared.document.close();
    if (this.open.get(shared.key) === shared) this.open.delete(shared.key);
  }
}
