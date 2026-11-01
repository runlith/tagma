import { Scope } from '@runlith/layer/Scope';
import { type Resolver, Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { Claims } from '$lib/shared/Claims.svelte.js';
import { Access, AccessHint, type AccessHintShape, type Gate, gateOf } from '$lib/wire/access.js';
import { draftHolder, type Holder, sectionHolder, threadHolder } from '$lib/shared/panes/holder.js';
import { type PaneContent, type PaneOpening, sameContent, type SidePane } from '$lib/shared/panes/pane.js';
import { PaneRegistry } from './PaneRegistry.js';
import { EMPTY_LAYOUT, type TabLayout, type TabLayouts, type TabOpen } from './TabLayouts.svelte.js';

export type Placement = { readonly layouts: TabLayouts; readonly holder: Holder };

export type HolderBorn = (from: Holder, to: Holder) => void;

export type MainSeat = { readonly activeId: string | null; readonly projectId: number };

type Shown = { readonly layouts: TabLayouts; readonly app: Resolver };

export class SidePanes extends Service<SidePanes>()('SidePanes', { tier: 'app' }) {
  static *make() {
    const panes = new SidePanes(yield* PaneRegistry, gateOf(yield* Access.optional(), 'read'), yield* AccessHint.optional());
    (yield* Scope).defer(panes.watch());
    return panes;
  }

  private readonly mains = new Claims<MainSeat>();

  private readonly attached = new Claims<Shown>();

  private surface = $state<string | null>(null);

  private focused = $state(false);

  private worked = $state.raw<readonly string[]>([]);

  private readonly heirs = new Set<HolderBorn>();

  private readonly activations = new SvelteMap<string | null, number>();

  private readonly openings = new SvelteMap<string, number>();

  readonly holder: Holder | null = $derived.by(() => {
    const page = this.mains.current;
    if (page !== null) return page.activeId === null ? draftHolder(page.projectId) : threadHolder(page.activeId);
    return this.surface === null ? null : sectionHolder(this.surface);
  });

  readonly layout: TabLayout = $derived.by(() => {
    const shown = this.shown;
    const holder = this.holder;
    if (shown === null || holder === null) return EMPTY_LAYOUT;
    return shown.layouts.standing(holder, (tab) => this.stands(shown.app, tab, holder) !== false);
  });

  readonly active: SidePane | null = $derived(this.layout.tabs.find((tab) => tab.key === this.layout.active) ?? null);

  readonly showing: boolean = $derived(this.layout.open && this.active !== null);

  constructor(
    readonly kinds: PaneRegistry,
    readonly gate: Gate,
    readonly hints?: AccessHintShape,
  ) {
    super();
  }

  get main(): MainSeat | null {
    return this.mains.current;
  }

  get section(): string | null {
    return this.surface;
  }

  get trail(): readonly string[] {
    return this.worked;
  }

  get layouts(): TabLayouts | null {
    return this.shown?.layouts ?? null;
  }

  get app(): Resolver | null {
    return this.shown?.app ?? null;
  }

  get panes(): readonly SidePane[] {
    return this.layout.tabs;
  }

  get focus(): string | null {
    return this.focused && this.showing ? this.layout.active : null;
  }

  attach(layouts: TabLayouts, app: Resolver): () => void {
    return this.attached.take({ layouts, app });
  }

  seatMain(seat: MainSeat): () => void {
    return this.mains.take(seat);
  }

  private get shown(): Shown | null {
    return this.attached.current;
  }

  showSection(surface: string | null): void {
    this.surface = surface;
  }

  inherit(heir: HolderBorn): () => void {
    this.heirs.add(heir);
    return () => {
      this.heirs.delete(heir);
    };
  }

  watch(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const shown = this.shown;
        const holder = this.holder;
        if (shown === null || holder === null) return;
        untrack(() => shown.layouts.touch(holder));
      });
      $effect(() => {
        const shown = this.shown;
        const holder = this.holder;
        if (shown === null || holder === null || this.layout === shown.layouts.layout(holder)) return;
        untrack(() => shown.layouts.prune(holder, (tab) => this.stands(shown.app, tab, holder) !== false));
      });
      $effect(() => {
        const standing = new Set(this.layout.tabs.map((tab) => tab.key));
        untrack(() => {
          for (const key of [...this.activations.keys()]) if (key !== null && !standing.has(key)) this.activations.delete(key);
          for (const key of [...this.openings.keys()]) if (!standing.has(key)) this.openings.delete(key);
        });
      });
    });
  }

  hosts(at: Placement): boolean {
    return this.shown !== null && this.shown.layouts.projectId === at.layouts.projectId && at.holder === this.holder;
  }

  showsProject(projectId: number): boolean {
    return this.shown?.layouts.projectId === projectId;
  }

  open(content: PaneContent, how: TabOpen = {}): PaneOpening {
    const layouts = this.layouts;
    const holder = this.holder;
    if (layouts === null || holder === null) return { kind: 'refused', reason: 'nowhere' };
    const opening = layouts.open(holder, content, how);
    if ((how.activate ?? true) && opening.kind !== 'refused') {
      if (how.quiet !== true) this.bump(opening.key);
      this.openings.set(opening.key, (this.openings.get(opening.key) ?? 0) + 1);
    }
    return opening;
  }

  openAt(at: Placement, content: PaneContent, how: TabOpen = {}): PaneOpening {
    return this.hosts(at) ? this.open(content, how) : at.layouts.open(at.holder, content, how);
  }

  opened(key: string): number {
    return this.openings.get(key) ?? 0;
  }

  holds(content: PaneContent): boolean {
    return content.id !== null && this.panes.some((pane) => sameContent(pane, content));
  }

  shows(content: PaneContent): boolean {
    const active = this.active;
    return this.showing && active !== null && active.kind === content.kind && (content.id === null || active.id === content.id);
  }

  toggle(content: PaneContent): void {
    const active = this.active;
    if (active !== null && this.shows(content)) {
      this.close(active.key);
      return;
    }
    this.open(content);
  }

  activation(key: string | null): number {
    return this.activations.get(key) ?? 0;
  }

  activate(key: string | null): void {
    const layouts = this.layouts;
    const holder = this.holder;
    if (key !== null && layouts !== null && holder !== null) layouts.activate(holder, key);
    this.bump(key);
  }

  step(direction: 1 | -1): void {
    const tabs = this.panes;
    if (tabs.length === 0) return;
    const at = tabs.findIndex((tab) => tab.key === this.layout.active);
    const next = tabs[(at + direction + tabs.length) % tabs.length];
    if (next !== undefined) this.activate(next.key);
  }

  activateAt(index: number): void {
    const tab = this.panes[index];
    if (tab !== undefined) this.activate(tab.key);
  }

  close(key: string): void {
    const shown = this.shown;
    const holder = this.holder;
    if (shown === null || holder === null) return;
    const pane = this.panes.find((standing) => standing.key === key);
    if (pane === undefined) return;
    if (this.kinds.find(pane.kind)?.close?.(shown.app, pane.id) === true) return;
    if (this.layout.active === key) this.focused = false;
    shown.layouts.close(holder, key);
  }

  closeAll(keys: readonly string[] = this.panes.map((pane) => pane.key)): void {
    for (const key of keys) this.close(key);
  }

  focusOn(key: string | null): void {
    this.focused = key !== null;
    if (key === null) {
      this.worked = [];
      return;
    }
    const trail = untrack(() => this.worked);
    if (trail.at(-1) !== key) this.worked = [...trail.filter((kept) => kept !== key), key];
  }

  point(key: string, id: string | null): void {
    const layouts = this.layouts;
    const holder = this.holder;
    if (layouts !== null && holder !== null) layouts.point(holder, key, id);
  }

  move(key: string, before: string | null): void {
    const layouts = this.layouts;
    const holder = this.holder;
    if (layouts !== null && holder !== null) layouts.move(holder, key, before);
  }

  showArea(open: boolean): void {
    const layouts = this.layouts;
    const holder = this.holder;
    if (layouts === null || holder === null) return;
    if (!open) this.focused = false;
    layouts.show(holder, open);
  }

  carry(thread: string): void {
    const page = this.mains.current;
    if (page === null) return;
    const from = draftHolder(page.projectId);
    const to = threadHolder(thread);
    if (this.shown?.layouts.projectId === page.projectId) this.shown.layouts.carry(from, to);
    for (const heir of this.heirs) heir(from, to);
  }

  private stands(app: Resolver, tab: SidePane, holder: Holder): boolean | null {
    return this.kinds.find(tab.kind)?.stands?.(app, tab.id, holder) ?? null;
  }

  private bump(key: string | null): void {
    this.focusOn(key);
    this.activations.set(key, (untrack(() => this.activations.get(key)) ?? 0) + 1);
  }
}
