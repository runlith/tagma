import type { TerminalRow, TerminalView } from '@tagma/server/executions/contract/wire/terminals';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { Router } from '@runlith/layer/Router';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { tick, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { holderThread, type Holder } from '$lib/shared/panes/holder.js';
import { SidePanes, type Placement } from '$lib/app/panes/SidePanes.svelte.js';
import { type TabOpen, TabLayouts } from '$lib/app/panes/TabLayouts.svelte.js';
import { type PlacesPort, ThreadPlaces } from '$lib/app/panes/ThreadPlaces.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { TerminalTabs } from '../terminal/Tabs.svelte.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { branchHref, currentBranch, currentProject } from '$lib/features/workspace/address.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { CHAT } from '$lib/features/workspace/surface.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { refusalOf, type Refusal } from '$lib/wire/refusal.js';
import { CommandActivity } from '../commands/Activity.svelte.js';
import { terminalPane, terminalPaneOf } from '../kind.js';
import { STANDING_INVENTORY, ExecutionsRepo, terminalAddress, terminalKey } from '../Repo.js';
import type { FitGrid } from '../terminal/Fit.js';
import type { TerminalAct } from '../terminal/Keymap.js';
import { storedLeafTabs, type StoredLayout, type StoredWorktrees } from './layout.js';
import { terminalPlace, type TerminalPlace } from './opens.js';
import { standing } from './standing.js';
import { TerminalSettings } from './TerminalSettings.svelte.js';
import { WorktreeTerminals } from './WorktreeTerminals.svelte.js';

export type Inventory = { readonly _tag: 'reading' } | { readonly _tag: 'failed'; readonly refusal: Refusal } | { readonly _tag: 'read' };

const RECENT_TABS = 32;

export class Terminals extends Service<Terminals>()('Terminals', { tier: 'project' }) {
  static *make() {
    const { projectId } = yield* ProjectRung.Current;
    return new Terminals(
      projectId,
      yield* ExecutionsRepo,
      yield* Notices,
      yield* SettingsRepo,
      yield* Worktrees,
      yield* CommandActivity,
      yield* Router,
      yield* Addresses,
      yield* ProjectFocus,
      yield* SidePanes,
      yield* ThreadPlaces,
      yield* TabLayouts,
      yield* Scope,
      yield* Live,
      yield* ThreadNames,
      yield* Workspace,
      yield* TerminalTabs,
    );
  }

  readonly worktrees = new SvelteMap<string, WorktreeTerminals>();
  private atHolders = $state.raw<WorktreeTerminals | null>(null);
  inventory = $state<Inventory>({ _tag: 'reading' });
  floorNotice = $state<string | null>(null);
  ceiling = $state.raw<FitGrid | null>(null);

  private mounts = $state(0);
  private loaded = $state(false);
  private readonly running: ReadonlySet<string>;
  private stored = new Map<string, StoredLayout>();
  private readonly lives = new Map<string, Scope>();
  private readonly seen = new Set<string>();
  private readonly store: TerminalSettings;
  private pending: Promise<void> | null = null;
  private reread = false;
  private revealing: { readonly key: string; readonly project: number } | null = null;
  private edited = false;
  private readonly listing: (() => void)[] = [];
  private readonly recent: string[] = [];

  constructor(
    readonly projectId: number,
    private readonly repo: ExecutionsRepo,
    private readonly notices: Notices,
    settings: SettingsRepo,
    private readonly rows: Worktrees,
    private readonly commands: CommandActivity,
    private readonly router: Router,
    private readonly addresses: Addresses,
    private readonly focus: ProjectFocus,
    private readonly panes: SidePanes,
    private readonly seats: PlacesPort,
    private readonly layouts: TabLayouts,
    private readonly scope: Scope,
    live: LiveConnection,
    private readonly names: ThreadNames,
    private readonly workspace: Workspace,
    private readonly tabs: TerminalTabs,
  ) {
    super();
    scope.defer(tabs.attach(projectId, this));
    this.store = new TerminalSettings(projectId, settings, notices, scope);
    this.running = $derived(
      new Set(commands.roster.flatMap((row) => (placeOf(row)?.kind !== 'checkout' ? [] : [terminalKey(row.record.execution)]))),
    );
    $effect(() => {
      const entries = this.store.catalog();
      if (entries !== null) untrack(() => this.learn(entries));
    });
    $effect(() => {
      const row = this.rows.aimed;
      if (row !== null) untrack(() => this.worktree(row.rootId));
    });
    $effect(() => {
      const roster = this.commands.roster;
      if (this.loaded) untrack(() => this.follow(roster));
    });
    $effect(() => {
      void this.rows.rows;
      const settled = this.rows.known || this.rows.unread !== null;
      untrack(() => {
        this.prune();
        if (settled) for (const done of this.listing.splice(0)) done();
      });
    });
    $effect(() => {
      for (const worktree of this.all) {
        for (const at of worktree.holders.values()) void this.tabs.of(at.projectId);
      }
      untrack(() => this.settle());
    });
    scope.defer(panes.inherit((from, to) => this.carry(from, to)));
    scope.defer(commands.onReading(() => this.recover()));
    scope.defer(
      live.subscribeStatus((status) => {
        if (status === 'open') this.recover();
      }),
    );
    void this.read();
  }

  get home(): WorktreeTerminals | null {
    const row = this.rows.aimed;
    return row === null ? null : (this.worktrees.get(row.rootId) ?? null);
  }

  get shown(): boolean {
    return this.mounts > 0 && (this.home?.shown ?? false);
  }

  get ready(): boolean {
    return this.loaded;
  }

  read(): Promise<void> {
    if (this.scope.closed || this.loaded) return Promise.resolve();
    this.pending ??= this.take().finally(() => {
      this.pending = null;
      if (!this.reread) return;
      this.reread = false;
      this.recover();
    });
    return this.pending;
  }

  private recover(): void {
    if (this.scope.closed || this.loaded) return;
    if (this.pending !== null) this.reread = true;
    else if (this.inventory._tag === 'failed') void this.read();
  }

  count(worktree: WorktreeTerminals | null): number {
    if (worktree === null) return 0;
    const running = [...this.running];
    return worktree.panel.filter((tab) => running.some((key) => tab.holdsExecution(key))).length;
  }

  rootOf(key: string): string | null {
    return this.worktreeOf(key)?.rootId ?? null;
  }

  worktreeOf(key: string): WorktreeTerminals | null {
    for (const worktree of this.all) {
      if (worktree.holds(key)) return worktree;
    }
    return null;
  }

  get all(): readonly WorktreeTerminals[] {
    const places = [...this.worktrees.values()];
    return this.atHolders === null ? places : [...places, this.atHolders];
  }

  private bucket(rootId: string | null): WorktreeTerminals {
    if (rootId !== null) return this.worktree(rootId);
    if (this.atHolders === null) {
      this.atHolders = WorktreeTerminals.start(this.scope.child('WorktreeTerminals:holders'), { rootId: null, terminals: this });
      this.atHolders.adopt(new Map(), null);
    }
    return this.atHolders;
  }

  worktree(rootId: string): WorktreeTerminals {
    const standing = this.worktrees.get(rootId);
    if (standing !== undefined) return standing;
    const life = this.scope.child(`WorktreeTerminals:${rootId}`);
    this.lives.set(rootId, life);
    const worktree = WorktreeTerminals.start(life, { rootId, terminals: this });
    this.worktrees.set(rootId, worktree);
    if (this.loaded) worktree.adopt(new Map(), this.stored.get(rootId) ?? null);
    return worktree;
  }

  dismissFloorNotice(): void {
    this.floorNotice = null;
  }

  mountPanel(): () => void {
    this.mounts = untrack(() => this.mounts) + 1;
    return () => {
      this.mounts = untrack(() => this.mounts) - 1;
    };
  }

  toggle(): void {
    const worktree = this.home;
    if (this.mounts === 0 || worktree === null) return;
    if (worktree.shown) {
      worktree.hide();
      return;
    }
    if (worktree.panel.length === 0) {
      void this.openPanel(worktree);
      return;
    }
    worktree.show();
    if (worktree.active !== null) worktree.select(worktree.active);
  }

  hide(): void {
    this.home?.hide();
  }

  async openBeside(): Promise<void> {
    const holder = this.here();
    if (holder === null) {
      this.notices.error('Terminal', 'This screen has no tabs beside to open a terminal in.');
      return;
    }
    const row = await this.homeReady();
    if (row === null) return;
    const worktree = this.worktree(row.rootId);
    this.lay(worktree, await worktree.open(holder), holder);
  }

  async openPanel(worktree: WorktreeTerminals): Promise<void> {
    const key = await worktree.open();
    if (key === null) return;
    worktree.show();
    worktree.select(key);
  }

  requestClose(id: string): boolean {
    const worktree = this.worktreeOf(id);
    const tab = worktree?.tabOf(id) ?? null;
    if (worktree === null || tab === null) return false;
    worktree.requestClose(tab.key);
    return true;
  }

  async detach(worktree: WorktreeTerminals, key: string, pane: string): Promise<void> {
    const holder = worktree.holderOf(key);
    const made = await worktree.detach(key, pane);
    if (holder !== null) this.lay(worktree, made, holder);
    else if (made !== null) worktree.select(made);
  }

  front(worktree: WorktreeTerminals, key: string): void {
    const shown = worktree.front(key);
    if (shown === null) return;
    const at = this.recent.indexOf(shown);
    if (at !== -1) this.recent.splice(at, 1);
    this.recent.push(shown);
    if (this.recent.length > RECENT_TABS) this.recent.shift();
  }

  perform(act: TerminalAct, worktree: WorktreeTerminals, key: string | null): boolean {
    if (act._tag === 'toggle-terminals') {
      this.toggle();
      return true;
    }
    const holder = key === null ? null : worktree.holderOf(key);
    return key === null || holder === null ? this.performInPanel(act, worktree) : this.performBeside(act, worktree, key, holder);
  }

  asksClose(): boolean {
    return this.store.asksClose();
  }

  stopAsking(): Promise<void> {
    return this.store.stopAsking();
  }

  persist(): void {
    if (!this.loaded) {
      this.edited = true;
      return;
    }
    this.store.save(this.snapshot());
    queueMicrotask(() => this.prune());
  }

  async reveal(key: string, shownProject = this.projectId): Promise<void> {
    const revealing = { key, project: shownProject };
    if (this.revealing?.key === key && this.revealing.project === revealing.project) return;
    this.revealing = revealing;
    try {
      const address = terminalAddress(key);
      if (address === null) {
        await this.readdress(null);
        return;
      }
      await this.read();
      let worktree = this.worktreeOf(key);
      if (worktree === null) {
        let listing;
        try {
          listing = await this.repo.record.key(address).refresh({ throwOnError: true });
        } catch (error) {
          this.notices.refusal(error);
          await this.readdress(null);
          return;
        }
        const record = listing?.record;
        if (record?.launchedFor !== undefined) {
          await this.readdress(null, record.launchedFor);
          return;
        }
        const place = record === undefined ? null : terminalPlace(record);
        if (record === undefined || place === null) {
          this.notices.error('Terminal', `Terminal ${key} is gone: no place of this project holds it.`);
          await this.readdress(null);
          return;
        }
        worktree = this.bucket(rootIdOf(place));
        worktree.bear(record);
        if (place.kind === 'holder') this.layAgent(key, record);
      }
      const owner = worktree.holderOf(key);
      if (owner === null && worktree.rootId === null) {
        this.notices.error('Terminal', `Terminal ${key} stands in no checkout, and the thread holding it is gone.`);
        return;
      }
      const thread = owner === null ? null : holderThread(owner);
      if (shownProject === this.projectId && !(await this.readdress(worktree.rootId, thread, key))) return;
      const revealed = worktree.reveal(key);
      const held = worktree.holderOf(key);
      if (held !== null) {
        const layouts = this.panes.layouts?.projectId === shownProject ? this.panes.layouts : this.tabs.of(shownProject)?.layouts;
        if (layouts === undefined) {
          this.notices.error('Terminal', `Project ${shownProject} has no open layout for this terminal.`);
          return;
        }
        this.lay(worktree, revealed, held, {}, { layouts, holder: held });
      } else {
        worktree.show();
        if (revealed !== null) worktree.select(revealed);
      }
      await this.clearReveal(key);
    } catch (error) {
      this.notices.refusal(error);
    } finally {
      if (this.revealing === revealing) this.revealing = null;
    }
  }

  async openIn(row: WorktreePlace): Promise<void> {
    if (!(await this.readdress(row.rootId))) return;
    await this.read();
    await this.openPanel(this.worktree(row.rootId));
  }

  private performInPanel(act: TerminalAct, worktree: WorktreeTerminals): boolean {
    const tabs = worktree.panel;
    const at = tabs.findIndex((tab) => tab.key === worktree.active);
    switch (act._tag) {
      case 'new-tab':
        void this.openPanel(worktree);
        return true;
      case 'reopen-tab':
        void worktree.reopen().then((key) => key !== null && worktree.select(key));
        return true;
      case 'rename-tab':
        worktree.beginRename();
        return true;
      case 'close-all-tabs':
        worktree.closeAll(tabs.map((tab) => tab.key));
        return true;
      case 'next-tab':
      case 'previous-tab': {
        const step = act._tag === 'next-tab' ? 1 : -1;
        const next = tabs[(at + step + tabs.length) % tabs.length];
        if (next !== undefined) worktree.select(next.key);
        return true;
      }
      case 'previous-recent-tab': {
        const previous = this.recent.slice(0, -1).findLast((recent) => tabs.some((tab) => tab.key === recent));
        if (previous !== undefined) worktree.select(previous);
        return true;
      }
      case 'select-index': {
        const tab = tabs[act.index];
        if (tab !== undefined) worktree.select(tab.key);
        return true;
      }
      default:
        return false;
    }
  }

  private performBeside(act: TerminalAct, worktree: WorktreeTerminals, key: string, holder: Holder): boolean {
    switch (act._tag) {
      case 'new-tab':
        void worktree.open(holder, key).then((made) => this.lay(worktree, made, holder));
        return true;
      case 'rename-tab':
        worktree.beginRename(worktree.tabOf(key)?.key ?? null);
        return true;
      case 'close-all-tabs':
        this.panes.closeAll();
        return true;
      case 'next-tab':
        this.panes.step(1);
        return true;
      case 'previous-tab':
        this.panes.step(-1);
        return true;
      case 'previous-recent-tab': {
        const previous = this.recent.slice(0, -1).findLast((recent) => this.panes.holds(terminalPane(this.projectId, recent)));
        if (previous !== undefined) this.panes.open(terminalPane(this.projectId, previous));
        return true;
      }
      case 'select-index':
        this.panes.activateAt(act.index);
        return true;
      default:
        return false;
    }
  }

  private here(): Holder | null {
    return this.panes.showsProject(this.projectId) ? this.panes.holder : null;
  }

  private lay(worktree: WorktreeTerminals, key: string | null, holder: Holder, how: TabOpen = {}, placement?: Placement): void {
    if (key === null) return;
    const content = terminalPane(this.projectId, key);
    const thread = holderThread(holder);
    const owner = worktree.ownerOf(key);
    const layouts = this.tabs.of(owner?.projectId ?? this.projectId)?.layouts;
    const at =
      placement ??
      (thread === null ? (layouts === undefined ? null : { layouts, holder }) : this.seats.place(this.layouts, thread, content));
    if (at === null) return;
    worktree.own(key, at.holder, at.layouts.projectId);
    const activate = how.activate ?? true;
    if (activate) this.front(worktree, key);
    this.panes.openAt(at, content, how);
    if (activate && this.panes.hosts(at)) worktree.focus(key);
  }

  private carry(from: Holder, to: Holder): void {
    for (const worktree of this.all) worktree.carry(from, to);
  }

  private async homeReady(): Promise<WorktreePlace | null> {
    const known = this.rows.known ? this.rows.aimed : null;
    await this.listed();
    await this.read();
    const row = known ?? this.rows.aimed;
    if (row === null) this.notices.error('Terminal', 'No checkout of this project is known, so there is no place to open a terminal in.');
    return row;
  }

  private learn(entries: readonly { readonly id: string; readonly value: unknown }[]): void {
    const stored = this.store.heard(entries);
    if (!this.loaded || stored === null) return;
    this.stored = stored;
    for (const [rootId, worktree] of this.worktrees) {
      const stored = this.stored.get(rootId);
      if (stored !== undefined) worktree.absorb(stored);
    }
    this.settle();
  }

  private async take(): Promise<void> {
    this.inventory = { _tag: 'reading' };
    try {
      const answer = await this.repo.inventory.key(STANDING_INVENTORY).refresh({ throwOnError: true });
      if (answer === undefined || this.scope.closed) return;
      this.floorNotice = answer.notice ?? null;
      this.ceiling = { cols: answer.geometry.columns, rows: answer.geometry.rows };
      const stored = await this.store.load();
      if (this.scope.closed) return;
      this.stored = stored;
      const live = new Map<string, Map<string, TerminalRow>>();
      const atHolders = new Map<string, TerminalRow>();
      for (const listing of answer.terminals) {
        const key = terminalKey(listing.record.execution);
        const place = placeOf(listing);
        if (place === null) continue;
        this.seen.add(key);
        if (place.kind === 'holder') {
          atHolders.set(key, listing);
          continue;
        }
        const held = live.get(place.rootId) ?? new Map<string, TerminalRow>();
        held.set(key, listing);
        live.set(place.rootId, held);
      }
      for (const rootId of new Set([...live.keys(), ...this.worktrees.keys()])) {
        this.worktree(rootId).adopt(live.get(rootId) ?? new Map(), this.stored.get(rootId) ?? null);
      }
      for (const listing of atHolders.values()) this.bucket(null).bear(listing.record);
      const known = new Set([...this.stored.values()].flatMap((layout) => [...storedLeafTabs(layout).keys()]));
      for (const held of [...live.values(), atHolders]) {
        for (const [key, listing] of held) if (!known.has(key)) this.layAgent(key, listing.record);
      }
      if (!this.edited) this.store.standsAs(this.snapshot());
      this.loaded = true;
      this.inventory = { _tag: 'read' };
      this.settle();
      if (this.edited) this.persist();
    } catch (error) {
      if (!this.scope.closed) this.inventory = { _tag: 'failed', refusal: refusalOf(error) };
    }
  }

  private settle(): void {
    for (const worktree of this.all) {
      for (const [key, owner] of worktree.holders) {
        const layouts = this.tabs.of(owner.projectId)?.layouts;
        if (worktree.owned(key) && layouts !== undefined)
          this.lay(worktree, key, owner.holder, { activate: false }, { layouts, holder: owner.holder });
      }
    }
  }

  private follow(roster: readonly TerminalRow[]): void {
    const live = new Set<string>();
    for (const listing of roster) {
      const key = terminalKey(listing.record.execution);
      live.add(key);
      const place = placeOf(listing);
      const rootId = place === null ? null : rootIdOf(place);
      const worktree = place === null ? null : rootId === null ? this.atHolders : (this.worktrees.get(rootId) ?? null);
      worktree?.note(listing.record);
      if (!standing(listing)) this.worktreeOf(key)?.heard(listing);
      if (place === null || this.seen.has(key)) continue;
      this.seen.add(key);
      if (this.worktreeOf(key) !== null) continue;
      this.bucket(rootId).bear(listing.record);
      this.layAgent(key, listing.record);
    }
    for (const key of this.seen) {
      if (!live.has(key)) this.seen.delete(key);
    }
  }

  private layAgent(key: string, record: TerminalView): void {
    const worktree = this.worktreeOf(key);
    const tab = worktree?.tabOf(key) ?? null;
    if (worktree === null || tab === null || record.holder === 'operator' || record.heldBy === undefined) return;
    const at = this.seats.place(this.layouts, record.heldBy, terminalPane(this.projectId, tab.key));
    this.lay(worktree, tab.key, at.holder, { activate: false, agent: true }, at);
  }

  private prune(): void {
    if (!this.rows.known) return;
    for (const [rootId, worktree] of this.worktrees) {
      if (this.stands(rootId) || worktree.tabs.length > 0 || this.rows.aimed?.rootId === rootId) continue;
      this.worktrees.delete(rootId);
      const life = this.lives.get(rootId);
      this.lives.delete(rootId);
      void life?.close();
    }
  }

  private listed(): Promise<void> {
    if (this.rows.known || this.rows.unread !== null) return Promise.resolve();
    return new Promise((done) => this.listing.push(done));
  }

  private stands(rootId: string): boolean {
    return !this.rows.known || this.rows.byRoot(rootId) !== null;
  }

  private async readdress(rootId: string | null, thread: string | null = null, key?: string): Promise<boolean> {
    if (rootId !== null) await this.listed();
    if (!this.focus.current) return true;
    const row = rootId === null ? null : this.rows.byRoot(rootId);
    const standing = currentBranch(this.router);
    const branch = row === null ? standing : row.kind === 'main' ? null : (row.branch ?? standing);
    if (thread !== null) {
      const owner = await this.names.read(thread);
      if (owner === undefined || (owner !== null && owner.projectId === undefined)) {
        this.notices.error('Terminal', `The home of thread ${thread} could not be read, so its terminal cannot open here.`);
        return false;
      }
      if (owner !== null) {
        const home = owner.projectId!;
        const [project] = await this.workspace.projectsOf([home]);
        if (!this.focus.current) return true;
        const path = this.addresses.place(project!.name, CHAT, thread, home === this.projectId ? branch : null);
        if (home !== this.projectId && key !== undefined) {
          const url = new URL(path, this.router.url);
          url.searchParams.set('terminal', terminalPane(this.projectId, key).id!);
          await this.router.replace(`${url.pathname}${url.search}`);
          return false;
        }
        await this.router.replace(path);
        return true;
      }
    }
    if (row !== null && this.elsewhere(row)) {
      await this.router.replace(this.addresses.place(currentProject(this.router), CHAT, null, branch));
      return true;
    }
    const url = new URL(branchHref(this.router, branch), this.router.url);
    url.searchParams.delete('terminal');
    await this.router.replace(`${url.pathname}${url.search}`);
    return true;
  }

  private async clearReveal(key: string): Promise<void> {
    const requested = terminalPaneOf(this.router.url.searchParams.get('terminal'), this.projectId);
    if (requested?.projectId !== this.projectId || requested.key !== key) return;
    await tick();
    const url = new URL(this.router.url);
    url.searchParams.delete('terminal');
    await this.router.replace(`${url.pathname}${url.search}`);
  }

  private elsewhere(row: WorktreePlace): boolean {
    const page = this.panes.main?.activeId ?? null;
    return page !== null && this.rows.known && this.rows.placeOf(page)?.rootId !== row.rootId;
  }

  private snapshot(): StoredWorktrees {
    const places: Record<string, StoredLayout> = {};
    for (const [rootId, layout] of this.stored) {
      if (this.worktrees.has(rootId) || !this.stands(rootId)) continue;
      if (layout.closed.length === 0 && !layout.shown) continue;
      places[rootId] = layout;
    }
    for (const [rootId, worktree] of this.worktrees) {
      if (worktree.tabs.length === 0 && !this.stands(rootId)) continue;
      places[rootId] = worktree.snapshot();
    }
    return { places };
  }
}

function placeOf(listing: TerminalRow): TerminalPlace | null {
  return standing(listing) ? terminalPlace(listing.record) : null;
}

const rootIdOf = (place: TerminalPlace): string | null => (place.kind === 'checkout' ? place.rootId : null);
