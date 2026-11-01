import type { ProcessReport } from '@runlith/executions/protocol/evidence';
import type { TerminalRow, TerminalView } from '@tagma/server/executions/contract/wire/terminals';
import { Host } from '@runlith/layer/Host';
import { Process } from '@runlith/layer/process';
import { Scope } from '@runlith/layer/Scope';
import { SvelteMap } from 'svelte/reactivity';
import { holderThread, type Holder, storedHolder } from '$lib/shared/panes/holder.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { ThreadNames, type AdoptedWords } from '$lib/shared/threads/Names.svelte.js';
import { foregroundOf } from '../processes/foreground.js';
import { ExecutionsRepo, terminalKey, type ExecutionAddress } from '../Repo.js';
import type { FitGrid } from '../terminal/Fit.js';
import { heldOf } from '../terminal/Holders.svelte.js';
import { paneIds } from '../terminal/paneLayout.js';
import { TerminalTab, openShell, servable, type TabRestore } from '../terminal/Tab.svelte.js';
import { sourceOf, type PaneSource } from '../terminal/Pane.svelte.js';
import { focusTabSurface, type FocusHelper } from '../terminal/terminalTabFocus.js';
import { planAdopt, pruneStoredTree, serializeTab, type StoredLayout, type StoredTab } from './layout.js';
import type { Terminals } from './Terminals.svelte.js';

const REOPEN_STACK = 32;

export type WorktreeBirth = { readonly rootId: string | null; readonly terminals: Terminals };
type TerminalHolder = { readonly projectId: number; readonly holder: Holder };

type Adopter = AdoptedWords | null | 'unknown';

export class WorktreeTerminals extends Process<WorktreeTerminals, WorktreeBirth>()('WorktreeTerminals', { tier: 'project' }) {
  static override *make(birth: WorktreeBirth) {
    return new WorktreeTerminals(
      birth.rootId,
      birth.terminals,
      (yield* ProjectRung.Current).projectId,
      yield* Worktrees,
      yield* ExecutionsRepo,
      yield* Notices,
      yield* Host,
      yield* Scope,
      yield* ThreadNames,
    );
  }

  readonly held = new SvelteMap<string, TerminalTab>();
  readonly titles = new SvelteMap<string, string>();
  readonly holders = new SvelteMap<string, TerminalHolder>();
  active = $state<string | null>(null);
  shown = $state(false);
  closed = $state.raw<readonly StoredTab[]>([]);
  opening = $state(false);
  renaming = $state<string | null>(null);
  closing = $state<{
    readonly key: string;
    readonly label: string;
    readonly thread: AdoptedWords | null;
    readonly terminals: readonly string[];
    readonly pane?: string;
  } | null>(null);

  readonly tabs = $derived([...this.held.values()]);
  readonly panel = $derived(this.tabs.filter((tab) => !this.owned(tab.key)));
  readonly current = $derived(this.active === null ? null : (this.held.get(this.active) ?? null));

  private readonly adopters = new SvelteMap<string, string>();
  private readonly lives = new Map<string, Scope>();
  private pendingStart: string | null = null;
  private closes: string[] = [];
  private sweeping = false;

  constructor(
    readonly rootId: string | null,
    private readonly terminals: Terminals,
    readonly projectId: number,
    private readonly worktrees: Worktrees,
    private readonly repo: ExecutionsRepo,
    private readonly notices: Notices,
    private readonly host: Host,
    private readonly scope: Scope,
    private readonly names: ThreadNames,
  ) {
    super();
  }

  get folder(): string | null {
    return this.rootId === null ? null : this.worktrees.folderOf(this.worktrees.byRoot(this.rootId));
  }

  tabOf(key: string): TerminalTab | null {
    return this.held.get(key) ?? this.tabs.find((tab) => tab.holdsExecution(key)) ?? null;
  }

  holds(key: string): boolean {
    return this.tabOf(key) !== null;
  }

  titleOf(tab: TerminalTab): string {
    return this.titles.get(tab.key) ?? tab.title;
  }

  holderOf(key: string): Holder | null {
    return this.ownerOf(key)?.holder ?? null;
  }

  ownerOf(key: string): TerminalHolder | null {
    const tab = this.tabOf(key);
    return tab === null || !this.owned(tab.key) ? null : (this.holders.get(tab.key) ?? null);
  }

  adopterOf(tab: TerminalTab): AdoptedWords | null {
    for (const address of this.liveAddresses(tab)) {
      const thread = this.adopters.get(address.execution);
      if (thread !== undefined) return this.wordsOf(thread);
    }
    return null;
  }

  adopt(live: ReadonlyMap<string, TerminalRow>, stored: StoredLayout | null): void {
    for (const group of planAdopt([...live.keys()], stored)) {
      const first = live.get(group.leaves[0] as string);
      if (first === undefined) continue;
      const storedTab = stored?.tabs[group.key];
      const tree = storedTab === undefined ? null : pruneStoredTree(storedTab.tree, new Set(group.leaves));
      const bindings: Record<string, { address: ExecutionAddress; source: PaneSource }> = {};
      const labels: Record<string, string> = {};
      for (const leaf of group.leaves) {
        const listing = live.get(leaf);
        if (listing !== undefined) bindings[leaf] = { address: listing.record.execution, source: sourceOf(listing.record.transport) };
      }
      if (tree !== null && storedTab !== undefined) {
        for (const [leaf, label] of Object.entries(storedTab.labels)) {
          if (live.has(leaf)) labels[leaf] = label;
        }
      }
      const restore = tree === null ? undefined : { tree, bindings, labels, active: storedTab?.active ?? null };
      const holder = tree === null || storedTab?.holder == null ? null : storedHolder(storedTab.holder);
      this.birth(group.key, first.record, restore, null, holder, storedTab?.holderProject ?? this.projectId);
    }
    if (stored !== null) {
      this.absorb(stored);
      this.closed = stored.closed.slice(-REOPEN_STACK);
      this.shown = stored.shown && this.panel.length > 0;
    }
    if (this.active === null) {
      const kept = stored?.active ?? null;
      this.active = kept !== null && this.panel.some((tab) => tab.key === kept) ? kept : (this.panel.at(-1)?.key ?? null);
    }
  }

  absorb(stored: StoredLayout): void {
    for (const [key, tab] of Object.entries(stored.tabs)) {
      if (!this.held.has(key)) continue;
      if (tab.title !== null) this.titles.set(key, tab.title);
      if (tab.holder !== null) this.holders.set(key, { holder: storedHolder(tab.holder), projectId: tab.holderProject ?? this.projectId });
    }
  }

  bear(record: TerminalView, holder: Holder | null = null): TerminalTab | null {
    return this.birth(terminalKey(record.execution), record, undefined, null, holder);
  }

  own(key: string, holder: Holder, projectId = this.projectId): void {
    const standing = this.holders.get(key);
    if (!this.held.has(key) || (standing?.holder === holder && standing.projectId === projectId)) return;
    this.holders.set(key, { holder, projectId });
    if (this.active === key) this.active = this.panel.at(-1)?.key ?? null;
    this.terminals.persist();
  }

  carry(from: Holder, to: Holder): void {
    const carried = [...this.holders].filter(([, at]) => at.holder === from);
    if (carried.length === 0) return;
    for (const [key, at] of carried) this.holders.set(key, { ...at, holder: to });
    this.terminals.persist();
  }

  owned(key: string): boolean {
    const holder = this.holders.get(key);
    if (holder === undefined) return false;
    const thread = holderThread(holder.holder);
    return thread === null || this.names.of(thread) !== null;
  }

  show(): void {
    this.keep(true);
  }

  hide(): void {
    this.keep(false);
  }

  move(key: string, before: string | null): void {
    if (key === before || !this.held.has(key)) return;
    const order = this.tabs.map((tab) => tab.key).filter((held) => held !== key);
    const at = before === null ? order.length : order.indexOf(before);
    if (at < 0) return;
    order.splice(at, 0, key);
    const tabs = order.flatMap((held) => {
      const tab = this.held.get(held);
      return tab === undefined ? [] : [[held, tab] as const];
    });
    this.held.clear();
    for (const [held, tab] of tabs) this.held.set(held, tab);
    this.terminals.persist();
  }

  reveal(key: string): string | null {
    const tab = this.tabs.find((held) => held.holdsExecution(key)) ?? this.held.get(key);
    if (tab === undefined) return null;
    for (const pane of tab.panes.values()) {
      if (pane.address !== null && terminalKey(pane.address) === key) pane.locate();
    }
    return tab.key;
  }

  select(key: string): void {
    const tab = this.front(key);
    if (tab !== null) this.focus(tab);
  }

  front(key: string): string | null {
    const tab = this.tabOf(key);
    if (tab === null) return null;
    tab.attention = false;
    if (this.owned(tab.key)) return tab.key;
    const moved = this.active !== tab.key;
    this.active = tab.key;
    if (moved) this.terminals.persist();
    return tab.key;
  }

  focus(key: string): void {
    const current = this.held.get(key);
    if (current === undefined) return;
    const renamingNow = (): boolean => this.renaming !== null || current.renaming !== null;
    focusTabSurface(() => helperFor(key, current.active), { renamingNow, isMac: this.host.apple });
  }

  beginRename(key = this.active): void {
    if (key !== null && this.held.has(key)) this.renaming = key;
  }

  commitRename(name: string): void {
    const key = this.renaming;
    this.renaming = null;
    if (key === null || !this.held.has(key)) return;
    const trimmed = name.trim();
    if (trimmed === '') this.titles.delete(key);
    else this.titles.set(key, trimmed);
    this.terminals.persist();
  }

  cancelRename(): void {
    this.renaming = null;
  }

  async open(holder: Holder | null = null, beside?: string): Promise<string | null> {
    const folder = this.folder ?? (beside === undefined ? null : (this.tabOf(beside)?.root ?? null));
    if (this.opening || folder === null || folder === '') return null;
    const owner = beside === undefined ? null : this.ownerOf(beside);
    this.opening = true;
    try {
      const started = await this.startShell(folder);
      if (started === null) return null;
      const tab = this.birth(
        terminalKey(started.address),
        started.record,
        undefined,
        started.born,
        holder,
        owner?.projectId ?? this.projectId,
      );
      if (tab !== null && holder === null) this.active = tab.key;
      this.terminals.persist();
      return tab?.key ?? null;
    } finally {
      this.opening = false;
    }
  }

  async reopen(at = this.closed.length - 1): Promise<string | null> {
    const folder = this.folder;
    if (folder === null || this.opening) return null;
    const snapshot = this.closed[at];
    if (snapshot === undefined) return null;
    const first = paneIds(snapshot.tree)[0];
    if (first === undefined) return null;
    this.closed = this.closed.filter((_, index) => index !== at);
    this.opening = true;
    try {
      const started = await this.startShell(folder);
      if (started === null) {
        this.closed = [...this.closed, snapshot];
        return null;
      }
      const key = terminalKey(started.address);
      const tab = this.birth(
        key,
        started.record,
        {
          tree: snapshot.tree,
          bindings: { [first]: { address: started.address, born: started.born } },
          labels: snapshot.labels,
          active: snapshot.active,
        },
        started.born,
      );
      if (snapshot.title !== null) this.titles.set(key, snapshot.title);
      if (tab !== null) this.active = tab.key;
      this.terminals.persist();
      return tab?.key ?? null;
    } finally {
      this.opening = false;
    }
  }

  async detach(sourceKey: string, paneId: string): Promise<string | null> {
    const source = this.held.get(sourceKey);
    if (source === undefined) return null;
    const owner = this.ownerOf(sourceKey);
    const address = source.detach(paneId);
    if (address === null) return null;
    const listing = await this.repo.record.key(address).refresh({ throwOnError: true });
    if (listing === undefined) return null;
    const free = terminalKey(address);
    const holder = owner?.holder ?? null;
    const tab = this.birth(
      this.held.has(free) ? `${free}~${crypto.randomUUID().slice(0, 8)}` : free,
      listing.record,
      undefined,
      null,
      holder,
      owner?.projectId ?? this.projectId,
    );
    if (tab !== null && holder === null) this.active = tab.key;
    this.terminals.persist();
    return tab?.key ?? null;
  }

  requestClose(key: string): void {
    this.closeAll([key]);
  }

  closeAll(keys: readonly string[]): void {
    for (const key of keys) if (!this.closes.includes(key)) this.closes.push(key);
    if (!this.sweeping && this.closing === null) void this.sweep();
  }

  confirmClose(dontAskAgain = false): void {
    const pending = this.closing;
    this.closing = null;
    if (pending === null) return;
    if (pending.pane !== undefined) {
      this.held.get(pending.key)?.close(pending.pane, true);
      void this.sweep();
      return;
    }
    if (dontAskAgain && pending.thread === null) void this.terminals.stopAsking();
    this.forceClose(pending.key);
    void this.sweep();
  }

  cancelClose(): void {
    this.closing = null;
    this.closes = [];
  }

  snapshot(): StoredLayout {
    const tabs: Record<string, StoredTab> = {};
    for (const tab of this.held.values()) {
      const stored = this.serialize(tab);
      if (stored !== null) tabs[tab.key] = stored;
    }
    return { order: this.tabs.map((held) => held.key), tabs, closed: this.closed, shown: this.shown, active: this.active };
  }

  private onScreen(key: string): boolean {
    if (!(this.held.get(key)?.mounted ?? false)) return false;
    return this.owned(key) || (this.shown && this.active === key);
  }

  private keep(shown: boolean): void {
    if (this.shown === shown) return;
    this.shown = shown;
    this.terminals.persist();
  }

  private async sweep(): Promise<void> {
    this.sweeping = true;
    try {
      for (let key = this.closes.shift(); key !== undefined; key = this.closes.shift()) {
        if (await this.closeOrAsk(key)) return;
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async closeOrAsk(key: string): Promise<boolean> {
    const tab = this.held.get(key);
    if (tab === undefined) return false;
    const adopter = await this.adopterNow(tab);
    if (!this.held.has(key)) return false;
    const thread = adopter === 'unknown' ? null : adopter;
    if (adopter === null && (!this.terminals.asksClose() || !(await this.running(tab)))) {
      this.forceClose(key);
      return false;
    }
    this.closing = { key, label: this.titleOf(tab), thread, terminals: this.closeTargets(tab) };
    return true;
  }

  private async confirmPane(key: string, pane: string, address: ExecutionAddress): Promise<void> {
    const adopter = await this.adopterAt(address);
    const tab = this.held.get(key);
    if (tab === undefined) return;
    if (adopter === null) {
      tab.close(pane, true);
      return;
    }
    const thread = adopter === 'unknown' ? null : adopter;
    this.closing = { key, label: tab.panes.get(pane)?.label ?? this.titleOf(tab), thread, pane, terminals: this.closeTargets(tab, pane) };
  }

  private async running(tab: TerminalTab): Promise<boolean> {
    for (const pane of tab.panes.values()) {
      const address = pane.address;
      if (address === null || pane.ending !== null) continue;
      if (foregroundOf(await this.processesOf(address)) !== null) return true;
    }
    return false;
  }

  private async processesOf(address: ExecutionAddress): Promise<ProcessReport | undefined> {
    try {
      const answer = await this.repo.processes.key(address).refresh({ throwOnError: true });
      return answer?.report;
    } catch {
      return undefined;
    }
  }

  private forceClose(key: string): void {
    const tab = this.held.get(key);
    if (tab === undefined) return;
    const owned = this.owned(key);
    const snapshot = owned ? null : this.serialize(tab);
    if (snapshot !== null) this.closed = [...this.closed, snapshot].slice(-REOPEN_STACK);
    const order = this.panel.map((held) => held.key);
    const at = order.indexOf(key);
    this.held.delete(key);
    this.titles.delete(key);
    this.holders.delete(key);
    const life = this.lives.get(key);
    this.lives.delete(key);
    void life?.close();
    if (this.closing?.key === key) this.closing = null;
    if (this.renaming === key) this.renaming = null;
    if (this.active === key) this.active = order[at + 1] ?? order[at - 1] ?? null;
    if (!owned && this.panel.length === 0) this.shown = false;
    tab.closeAll();
    this.terminals.persist();
  }

  private closeTargets(tab: TerminalTab, paneId?: string): readonly string[] {
    return [...tab.panes].flatMap(([id, pane]) =>
      pane.address === null || pane.ending !== null || (paneId !== undefined && id !== paneId)
        ? []
        : [`${terminalKey(pane.address)} · ${pane.cwd ?? tab.root}`],
    );
  }

  private serialize(tab: TerminalTab): StoredTab | null {
    return serializeTab(
      tab.layout,
      (pane) => {
        const address = tab.panes.get(pane)?.address ?? null;
        return address === null ? null : terminalKey(address);
      },
      (pane) => tab.panes.get(pane)?.label ?? null,
      this.titles.get(tab.key) ?? null,
      tab.active,
      this.holders.get(tab.key)?.holder ?? null,
      this.holders.get(tab.key)?.projectId,
    );
  }

  private liveAddresses(tab: TerminalTab): ExecutionAddress[] {
    return [...tab.panes.values()].flatMap((pane) => (pane.address === null || pane.ending !== null ? [] : [pane.address]));
  }

  private wordsOf(thread: string): AdoptedWords {
    return { thread, label: this.names.of(thread)?.label ?? thread };
  }

  note(record: TerminalView): void {
    if (record.adoptedBy === undefined) this.adopters.delete(record.execution.execution);
    else this.adopters.set(record.execution.execution, record.adoptedBy);
  }

  heard(listing: TerminalRow): void {
    const state = listing.state;
    if (state?.phase !== 'ended') return;
    const key = terminalKey(listing.record.execution);
    const native = state.nativeExit;
    for (const pane of this.tabOf(key)?.panes.values() ?? []) {
      if (pane.parked && pane.address !== null && terminalKey(pane.address) === key)
        pane.end(native === undefined ? { _tag: 'None' } : { _tag: 'Exit', native });
    }
  }

  private async adopterAt(address: ExecutionAddress): Promise<Adopter> {
    try {
      const listing = await this.repo.record.key(address).refresh({ throwOnError: true });
      if (listing !== undefined) this.note(listing.record);
    } catch {
      return 'unknown';
    }
    const thread = this.adopters.get(address.execution);
    return thread === undefined ? null : this.wordsOf(thread);
  }

  private async adopterNow(tab: TerminalTab): Promise<Adopter> {
    let found: Adopter = null;
    for (const address of this.liveAddresses(tab)) {
      const adopter = await this.adopterAt(address);
      if (adopter === 'unknown') found ??= adopter;
      else if (adopter !== null) found = adopter;
    }
    return found;
  }

  private birth(
    key: string,
    record: TerminalView,
    restore?: TabRestore,
    born: FitGrid | null = null,
    holder: Holder | null = null,
    holderProject = this.projectId,
  ): TerminalTab | null {
    this.note(record);
    const standing = this.held.get(key);
    if (standing !== undefined) {
      if (holder !== null) this.holders.set(key, { holder, projectId: holderProject });
      return standing;
    }
    if (holder !== null) this.holders.set(key, { holder, projectId: holderProject });
    const life = this.scope.child(`TerminalTab:${key}`);
    this.lives.set(key, life);
    const tab = TerminalTab.start(life, {
      key,
      execution: { execution: record.execution.execution, incarnation: record.execution.incarnation },
      born,
      agent: heldOf(record).holder ?? undefined,
      source: sourceOf(record.transport),
      program:
        record.holder === 'operator' ? (record.program ?? 'shell') : (record.label ?? record.commandLine ?? record.program ?? 'shell'),
      projectId: this.projectId,
      root: record.cwd ?? this.folder ?? '',
      visible: () => this.onScreen(key),
      ceiling: () => this.terminals.ceiling,
      onEmpty: () => this.requestClose(key),
      onStripAct: (act) => this.terminals.perform(act, this, key),
      onLayout: () => this.terminals.persist(),
      asksClose: (pane, address) => {
        void this.confirmPane(key, pane, address);
        return true;
      },
      restore,
    });
    this.held.set(key, tab);
    return tab;
  }

  private async startShell(cwd: string): Promise<{ address: ExecutionAddress; record: TerminalView; born: FitGrid | null } | null> {
    const measured = this.current?.current?.measuredGrid() ?? null;
    const born = servable(measured, this.terminals.ceiling);
    const outcome = await openShell(this.repo, cwd, this.pendingStart, born);
    this.pendingStart = outcome.retain;
    if (outcome._tag === 'Refused') {
      this.notices.refusal(outcome.error);
      return null;
    }
    if (outcome._tag === 'Unanswered') {
      this.notices.error('Terminal', outcome.problem);
      return null;
    }
    this.pendingStart = outcome.operation;
    try {
      const listing = await this.repo.record.key(outcome.execution).refresh({ throwOnError: true });
      if (listing === undefined) return null;
      this.pendingStart = null;
      return { address: outcome.execution, record: listing.record, born };
    } catch (error) {
      this.notices.refusal(error);
      return null;
    }
  }
}

function helperFor(key: string, pane: string): FocusHelper | null {
  if (typeof document === 'undefined') return null;
  const tab = document.querySelector(`[data-terminal-tab-id="${key}"]`);
  const helper =
    tab?.querySelector(`[data-pane-id="${pane}"] .xterm-helper-textarea`) ?? tab?.querySelector('.xterm-helper-textarea') ?? null;
  return helper instanceof HTMLElement ? helper : null;
}
