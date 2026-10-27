import type { Seen } from '@runlith/code-editor/marks';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { untrack } from 'svelte';
import { Dialogs } from '@runlith/primitives/DialogRegistry.svelte';
import { Service } from '@runlith/layer/key';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { FileOpener, type Located } from './FileOpener.svelte.js';
import { Closing } from './Closing.js';
import { Column } from './Column.svelte.js';
import { AutoSave } from './AutoSave.svelte.js';
import { type DocumentPlace, within } from './documentKey.js';
import { Documents } from './Documents.svelte.js';
import { CLOSED_KEPT, documentJson, documentOf, type DiffAim, kindFor, RECENT_KEPT, type Tab, tabId, type TabTarget } from './tab.js';

export type OpenHow = 'preview' | 'open';

const storageKey = (aim: GraphAim): string => `tagma.files:${aim.projectId}:${aim.branch ?? ''}`;

const pinnedFirst = (tabs: readonly Tab[]): readonly Tab[] => [
  ...tabs.filter((tab) => tab.state === 'pinned'),
  ...tabs.filter((tab) => tab.state !== 'pinned'),
];

export class Tabs extends Service<Tabs>()('Tabs', { tier: 'graph', eager: true }) {
  static *make() {
    const platform = yield* Platform;
    const documents = yield* Documents;
    const aim = yield* GraphRung.Current;
    return new Tabs(
      platform.storage.local,
      aim,
      yield* Checkout,
      yield* FileOpener,
      yield* Column,
      documents,
      new Closing(documents, yield* Dialogs, yield* AutoSave, aim.projectId, yield* Workspace, yield* Worktrees),
      yield* Scope,
    );
  }

  //! Svelte hands an effect teardown the previous value of state, so reads and writes go through plain fields and the state only mirrors them.
  private list: readonly Tab[] = [];
  private current: string | null = null;
  private recents: readonly string[] = [];
  #tabs = $state.raw<readonly Tab[]>([]);
  #active = $state<string | null>(null);
  #recent = $state.raw<readonly string[]>([]);

  get tabs(): readonly Tab[] {
    return this.#tabs;
  }

  get projectId(): number {
    return this.aim.projectId;
  }

  get activeId(): string | null {
    return this.#active;
  }

  get recent(): readonly string[] {
    return this.#recent;
  }

  private closed: readonly Tab[] = [];

  constructor(
    private readonly storage: PlatformStorage,
    private readonly aim: GraphAim,
    private readonly checkout: Checkout,
    opener: FileOpener,
    private readonly column: Column,
    private readonly documents: Documents,
    private readonly closing: Closing,
    scope: Scope,
  ) {
    super();
    const stored = documentOf(storage.getItem(storageKey(aim)));
    this.list = pinnedFirst(stored.tabs);
    this.current = stored.active;
    this.recents = stored.recent;
    this.publish();
    const standing = $derived.by(() => checkout.row?.rootId ?? null);
    const stop = $effect.root(() => {
      $effect(() => {
        const root = standing;
        if (root !== null) untrack(() => this.rebind(root));
      });
    });
    scope.defer(stop);
    scope.defer(
      documents.onRelocated((place, from, to) => {
        if (place.projectId === aim.projectId) this.retarget(place.rootId, [{ from, to }]);
      }),
    );
    scope.defer(
      opener.stand(aim, {
        rootId: () => this.checkout.row?.rootId ?? null,
        show: (located, reveal) => this.show(located, reveal),
      }),
    );
  }

  orphaned(tab: Tab): boolean {
    if (tab.branch === null) return false;
    const branches = this.checkout.branches;
    return branches.length > 0 && !branches.some((one) => one.branch === tab.branch);
  }

  private rebind(root: RootId): void {
    const stale = (tab: Tab): boolean => tab.branch === null && tab.rootId !== null && tab.rootId !== root;
    if (!this.list.some(stale) && !this.closed.some(stale)) return;
    const moved = (tab: Tab): Tab =>
      stale(tab) ? { ...tab, rootId: root, id: tabId({ rootId: root, path: tab.path, kind: tab.kind }) } : tab;
    const names = new Map(this.list.filter(stale).map((tab) => [tab.id, moved(tab).id]));
    const seen = new Set<string>();
    this.list = this.list.map(moved).filter((tab) => !seen.has(tab.id) && (seen.add(tab.id), true));
    this.closed = this.closed.map(moved);
    if (this.current !== null) this.current = names.get(this.current) ?? this.current;
    this.save();
  }

  get active(): Tab | null {
    return this.#tabs.find((tab) => tab.id === this.#active) ?? null;
  }

  get reopenable(): boolean {
    return this.closed.length > 0;
  }

  private show(located: Located, reveal: boolean): void {
    if (reveal) this.column.show('files');
    const goto = located.line === null ? null : { line: Math.max(located.line - 1, 0), column: Math.max((located.column ?? 1) - 1, 0) };
    this.open(
      { rootId: located.rootId, branch: located.branch, path: located.path, kind: kindFor(located.path, goto !== null), goto },
      'open',
    );
  }

  open(target: TabTarget, how: OpenHow): Tab {
    const id = tabId(target);
    const goto = target.goto ?? null;
    const found = this.list.find((tab) => tab.id === id);
    let next: Tab;
    if (found !== undefined) {
      next = {
        ...found,
        state: found.state === 'preview' && how === 'open' ? 'open' : found.state,
        diff: target.diff ?? found.diff,
        goto,
      };
      this.list = this.list.map((tab) => (tab.id === id ? next : tab));
    } else {
      next = {
        id,
        rootId: target.rootId,
        branch: target.branch ?? null,
        path: target.path,
        kind: target.kind,
        diff: target.kind === 'diff' ? (target.diff ?? { commit: null, side: null }) : null,
        state: how === 'open' ? 'open' : 'preview',
        view: null,
        goto,
      };
      const replaced = how === 'preview' ? this.list.findIndex((tab) => tab.state === 'preview') : -1;
      this.list = replaced === -1 ? pinnedFirst([...this.list, next]) : this.list.map((tab, at) => (at === replaced ? next : tab));
    }
    this.current = id;
    if (target.kind !== 'diff' && target.kind !== 'compare') this.remember(target.path);
    this.save();
    return next;
  }

  activate(id: string): void {
    if (this.current === id || !this.list.some((tab) => tab.id === id)) return;
    this.current = id;
    this.save();
  }

  keep(id: string): void {
    this.change(id, (tab) => (tab.state === 'preview' ? { ...tab, state: 'open' } : tab));
  }

  pin(id: string, pinned: boolean): void {
    this.change(id, (tab) => ({ ...tab, state: pinned ? 'pinned' : 'open' }));
    this.list = pinnedFirst(this.list);
    this.save();
  }

  move(id: string, before: string | null): void {
    const moved = this.list.find((tab) => tab.id === id);
    if (moved === undefined || id === before) return;
    const rest = this.list.filter((tab) => tab.id !== id);
    const at = before === null ? rest.length : rest.findIndex((tab) => tab.id === before);
    if (at === -1) return;
    const pinned = moved.state === 'pinned' ? at === 0 || rest[at - 1]?.state === 'pinned' : rest[at]?.state === 'pinned';
    const kept: Tab = { ...moved, state: pinned ? 'pinned' : 'open' };
    this.list = [...rest.slice(0, at), kept, ...rest.slice(at)];
    this.save();
  }

  see(id: string, view: Seen): void {
    const seen = (tab: Tab): boolean =>
      tab.view !== null &&
      tab.view.line === view.line &&
      tab.view.column === view.column &&
      tab.view.scroll === view.scroll &&
      tab.view.anchor?.line === view.anchor?.line &&
      tab.view.anchor?.column === view.anchor?.column;
    if (!this.list.some((tab) => tab.id === id)) {
      this.closed = this.closed.map((tab) => (tab.id === id ? { ...tab, view } : tab));
      return;
    }
    this.change(id, (tab) => (seen(tab) ? tab : { ...tab, view }));
  }

  aimDiff(id: string, diff: DiffAim): void {
    this.change(id, (tab) => (tab.kind === 'diff' ? { ...tab, diff } : tab));
  }

  arrived(id: string): void {
    this.change(id, (tab) => (tab.goto === null ? tab : { ...tab, goto: null }), false);
  }

  close(id: string): void {
    const tab = this.list.find((one) => one.id === id);
    if (tab === undefined) return;
    if (!this.closing.unsettled(tab)) {
      this.remove(id);
      return;
    }
    void this.closing.allowed([tab]).then((allowed) => {
      if (allowed.length > 0) this.remove(id);
    });
  }

  private remove(id: string): void {
    const at = this.list.findIndex((tab) => tab.id === id);
    if (at === -1) return;
    const gone = this.list[at] as Tab;
    const rest = this.list.filter((tab) => tab.id !== id);
    this.list = rest;
    this.documents.abandon(this.placeOf(gone.rootId), gone.path);
    this.remembered([gone]);
    if (this.current === id) this.current = (rest[at] ?? rest[at - 1] ?? null)?.id ?? null;
    this.save();
  }

  closeOthers(id: string): void {
    this.sweep((tab) => tab.id !== id, id);
  }

  closeRight(id: string): void {
    const at = this.list.findIndex((tab) => tab.id === id);
    if (at === -1) return;
    const right = new Set(this.list.slice(at + 1).map((tab) => tab.id));
    this.sweep((tab) => right.has(tab.id), id);
  }

  closeAll(): void {
    this.sweep(() => true, null);
  }

  reopen(): Tab | null {
    const back = this.closed.at(-1);
    if (back === undefined) return null;
    this.closed = this.closed.slice(0, -1);
    const reopened = this.open(
      { rootId: back.rootId, branch: back.branch, path: back.path, kind: back.kind, diff: back.diff, goto: null },
      'open',
    );
    if (back.view !== null) this.see(reopened.id, back.view);
    if (back.state === 'pinned') this.pin(reopened.id, true);
    return this.list.find((tab) => tab.id === reopened.id) ?? reopened;
  }

  step(direction: 1 | -1): void {
    if (this.list.length === 0) return;
    const at = this.list.findIndex((tab) => tab.id === this.current);
    const next = this.list[(at + direction + this.list.length) % this.list.length];
    if (next !== undefined) this.activate(next.id);
  }

  nth(place: number): void {
    const tab = place >= 9 ? this.list.at(-1) : this.list[place - 1];
    if (tab !== undefined) this.activate(tab.id);
  }

  forget(path: string): void {
    this.recents = this.recents.filter((one) => one !== path);
    this.save();
  }

  retarget(rootId: RootId | null, pairs: readonly { readonly from: string; readonly to: string }[]): void {
    const pathOf = (path: string): string => {
      for (const pair of pairs) if (within(path, pair.from)) return pair.to + path.slice(pair.from.length);
      return path;
    };
    const moved = (tab: Tab): Tab => {
      const path = tab.rootId === rootId ? pathOf(tab.path) : tab.path;
      return path === tab.path ? tab : { ...tab, path, id: tabId({ rootId, path, kind: tab.kind }) };
    };
    if (!this.list.some((tab) => moved(tab) !== tab) && !this.closed.some((tab) => moved(tab) !== tab)) return;
    const names = new Map(this.list.map((tab) => [tab.id, moved(tab).id]));
    const seen = new Set<string>();
    this.list = this.list.map(moved).filter((tab) => !seen.has(tab.id) && (seen.add(tab.id), true));
    this.closed = this.closed.map(moved);
    this.recents = this.recents.map(pathOf);
    if (this.current !== null) this.current = names.get(this.current) ?? this.current;
    this.save();
  }

  markDeleted(rootId: RootId, paths: readonly string[], gone: boolean): void {
    const hit = [...this.list, ...this.closed].filter((tab) => tab.rootId === rootId && paths.some((path) => within(tab.path, path)));
    this.documents.markGone(
      this.placeOf(rootId),
      hit.map((tab) => tab.path),
      gone,
    );
  }

  goneFile(tab: Tab): boolean {
    return this.documents.isGone(this.placeOf(tab.rootId), tab.path);
  }

  private placeOf(rootId: RootId | null): DocumentPlace {
    return { projectId: this.aim.projectId, rootId };
  }

  private sweep(doomed: (tab: Tab) => boolean, keep: string | null): void {
    const gone = this.list.filter((tab) => tab.state !== 'pinned' && doomed(tab));
    if (gone.length === 0) return;
    const dirty = gone.filter((tab) => this.closing.unsettled(tab));
    if (dirty.length === 0) {
      this.sweepNow(gone, keep);
      return;
    }
    const clean = gone.filter((tab) => !dirty.includes(tab));
    if (clean.length > 0) this.sweepNow(clean, keep);
    void this.closing.allowed(dirty).then((allowed) => {
      if (allowed.length > 0) this.sweepNow(allowed, keep);
    });
  }

  private sweepNow(gone: readonly Tab[], keep: string | null): void {
    const out = new Set(gone.map((tab) => tab.id));
    this.list = this.list.filter((tab) => !out.has(tab.id));
    for (const tab of gone) this.documents.abandon(this.placeOf(tab.rootId), tab.path);
    this.remembered(gone);
    if (this.current === null || out.has(this.current)) this.current = keep ?? this.list.at(-1)?.id ?? null;
    this.save();
  }

  private remembered(gone: readonly Tab[]): void {
    this.closed = [...this.closed, ...gone.filter((tab) => tab.state !== 'preview')].slice(-CLOSED_KEPT);
  }

  private remember(path: string): void {
    this.recents = [path, ...this.recents.filter((one) => one !== path)].slice(0, RECENT_KEPT);
  }

  private change(id: string, edit: (tab: Tab) => Tab, save = true): void {
    const before = this.list.find((tab) => tab.id === id);
    if (before === undefined) return;
    const after = edit(before);
    if (after === before) return;
    this.list = this.list.map((tab) => (tab.id === id ? after : tab));
    if (save) this.save();
    else this.publish();
  }

  private publish(): void {
    this.#tabs = this.list;
    this.#active = this.current;
    this.#recent = this.recents;
  }

  private save(): void {
    this.publish();
    this.storage.setItem(storageKey(this.aim), documentJson({ tabs: this.list, active: this.current, recent: this.recents }));
  }
}
