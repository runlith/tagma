import { Process } from '@runlith/layer/process';
import { Scope } from '@runlith/layer/Scope';
import { SvelteMap } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { TerminalAppearance } from '../appearance/Settings.svelte.js';
import type { FitGrid } from './Fit.js';
import { TerminalPane, type PaneSource } from './Pane.svelte.js';
import { TerminalRenderPolicy } from './RenderPolicy.js';
import type { TerminalAct } from './Keymap.js';
import { paneAct } from './paneActs.js';
import { ExecutionsRepo, type ExecutionAddress, terminalKey } from '../Repo.js';
import {
  equalise,
  hasPane,
  movePane,
  neighbourPane,
  paneCount,
  paneIds,
  paneNode,
  removePane,
  setRatio,
  splitPane,
  type DropZone,
  type PaneNode,
  type SplitDirection,
  type SplitPath,
} from './paneLayout.js';

type Repo = ReturnType<typeof ExecutionsRepo.use>;

export type TabBirth = {
  readonly key: string;
  readonly execution: ExecutionAddress;
  readonly born?: FitGrid | null;
  readonly agent?: string;
  readonly source?: PaneSource;
  readonly program: string;
  readonly projectId: number;
  readonly root: string;
  readonly visible: () => boolean;
  readonly ceiling: () => FitGrid | null;
  readonly onEmpty: () => void;
  readonly onStripAct: (act: TerminalAct) => boolean;
  readonly restore?: TabRestore;
  readonly onLayout?: () => void;
  readonly asksClose?: (pane: string, address: ExecutionAddress) => boolean;
};

export type TabRestore = {
  readonly tree: PaneNode;
  readonly bindings: Readonly<
    Record<string, { readonly address: ExecutionAddress; readonly born?: FitGrid | null; readonly source?: PaneSource }>
  >;
  readonly labels?: Readonly<Record<string, string>>;
  readonly active?: string | null;
};

export type TabStatus = 'opening' | 'live' | 'ended' | 'lost';

type PendingSplit = { readonly source: string; readonly direction: SplitDirection };

const MAX_QUEUED_SPLITS = 32;

const MENU_GESTURE_MS = 100;

export class TerminalTab extends Process<TerminalTab, TabBirth>()('TerminalTab') {
  static override *make(birth: TabBirth) {
    return new TerminalTab(
      birth,
      yield* ExecutionsRepo,
      yield* TerminalRenderPolicy,
      yield* TerminalAppearance,
      yield* Notices,
      yield* Scope,
    );
  }

  readonly key: string;
  readonly projectId: number;
  readonly root: string;

  layout = $state.raw<PaneNode>(paneNode(''));
  active = $state('');
  expanded = $state<string | null>(null);
  renaming = $state<string | null>(null);
  attention = $state(false);
  dragging = $state<string | null>(null);
  drop = $state<{ readonly pane: string; readonly zone: DropZone } | null>(null);
  menu = $state<{ readonly pane: string; readonly x: number; readonly y: number; readonly at: number } | null>(null);
  mounted = $state(false);

  readonly panes = new SvelteMap<string, TerminalPane>();

  readonly order = $derived(paneIds(this.layout));
  readonly count = $derived(paneCount(this.layout));
  readonly current = $derived(this.panes.get(this.active) ?? null);
  readonly title = $derived(this.current?.label ?? this.current?.title ?? '');
  readonly status = $derived<TabStatus>(
    this.current === null
      ? 'opening'
      : this.current.ending !== null
        ? 'ended'
        : this.current.problem !== null
          ? 'lost'
          : this.current.address === null
            ? 'opening'
            : 'live',
  );

  private readonly program: string;
  private readonly onScreen: () => boolean;
  private readonly hostCeiling: () => FitGrid | null;
  private readonly onEmpty: () => void;
  private readonly onStripAct: (act: TerminalAct) => boolean;
  private readonly onLayout: (() => void) | undefined;
  private readonly asksClose: TabBirth['asksClose'];
  private readonly lives = new Map<string, Scope>();
  private queued: PendingSplit[] = [];
  private refitFrame: number | null = null;
  private shown: boolean | null = null;

  constructor(
    birth: TabBirth,
    private readonly repo: Repo,
    private readonly policy: TerminalRenderPolicy,
    private readonly appearance: TerminalAppearance,
    private readonly notices: Notices,
    private readonly scope: Scope,
  ) {
    super();
    this.key = birth.key;
    this.projectId = birth.projectId;
    this.root = birth.root;
    this.program = birth.program;
    this.onScreen = birth.visible;
    this.hostCeiling = birth.ceiling;
    this.onEmpty = birth.onEmpty;
    this.onStripAct = birth.onStripAct;
    this.onLayout = birth.onLayout;
    this.asksClose = birth.asksClose;

    if (birth.restore === undefined) {
      const first = crypto.randomUUID();
      this.layout = paneNode(first);
      this.active = first;
      const pane = this.raise(first);
      pane.bind(birth.execution, { born: birth.born ?? null, agent: birth.agent ?? null, source: birth.source });
    } else {
      const restored = restoreLayout(birth.restore.tree);
      this.layout = restored.layout;
      const chosen = restored.leaves.find(([leaf]) => leaf === birth.restore?.active);
      this.active = chosen === undefined ? restored.first : chosen[1];
      for (const [leaf, id] of restored.leaves) {
        const pane = this.raise(id);
        const binding = birth.restore.bindings[leaf];
        if (binding === undefined) void this.spawn(id, this.root);
        else pane.bind(binding.address, { born: binding.born ?? null, source: binding.source });
        const label = birth.restore.labels?.[leaf];
        if (label !== undefined) pane.label = label;
      }
    }

    $effect(() => {
      const on = this.onScreen();
      untrack(() => this.reveal(on));
    });

    $effect(() => {
      void this.expanded;
      untrack(() => {
        if (this.shown !== true) return;
        for (const [id, pane] of this.panes) pane.reveal(this.visible(id));
      });
    });

    scope.defer(() => {
      if (this.refitFrame !== null) cancelAnimationFrame(this.refitFrame);
      this.refitFrame = null;
    });
  }

  visible(paneId?: string): boolean {
    return this.onScreen() && (paneId === undefined || this.expanded === null || this.expanded === paneId);
  }

  focused(paneId: string): boolean {
    return this.onScreen() && this.active === paneId;
  }

  ceiling(): FitGrid | null {
    return this.hostCeiling();
  }

  noteBell(): void {
    if (!this.onScreen()) this.attention = true;
  }

  readonly style = $derived.by(() => {
    void this.appearance.paneBackground;
    return this.appearance.paneStyle();
  });

  holdsExecution(key: string): boolean {
    for (const pane of this.panes.values()) {
      const address = pane.address;
      if (address !== null && terminalKey(address) === key) return true;
    }
    return false;
  }

  closeAll(): void {
    for (const pane of this.panes.values()) {
      const address = pane.address;
      if (address !== null && pane.ending === null) void this.stop(address);
    }
    this.panes.clear();
    this.lives.clear();
  }

  openMenu(pane: string, x: number, y: number): boolean {
    if (!this.panes.has(pane)) return false;
    this.activate(pane);
    this.menu = { pane, x, y, at: Date.now() };
    return true;
  }

  closeMenu(force = true): void {
    const menu = this.menu;
    if (menu === null) return;
    if (!force && Date.now() - menu.at < MENU_GESTURE_MS) return;
    this.menu = null;
  }

  holds(id: string): boolean {
    return this.active === id;
  }

  mount(): void {
    this.mounted = true;
    const queued = this.queued;
    this.queued = [];
    for (const request of queued) {
      const source = this.panes.get(request.source);
      if (source !== undefined) void this.split(source, request.direction);
    }
  }

  unmount(): void {
    this.mounted = false;
  }

  activate(id: string, focus = true): void {
    const moved = this.active !== id;
    if (this.point(id, focus) && moved) this.notifyLayout();
  }

  private point(id: string, focus = true): boolean {
    if (!this.panes.has(id)) return false;
    this.active = id;
    if (focus) this.panes.get(id)?.focus();
    return true;
  }

  async split(source: TerminalPane, direction: SplitDirection): Promise<void> {
    if (!this.mounted) {
      if (this.queued.length < MAX_QUEUED_SPLITS) this.queued.push({ source: source.id, direction });
      return;
    }
    const id = crypto.randomUUID();
    this.raise(id);
    this.layout = splitPane(this.layout, source.id, id, direction);
    this.expanded = null;
    this.point(id);
    this.refit();
    this.notifyLayout();
    const measured = source.measuredGrid();
    await this.spawn(id, source.cwd ?? this.root, measured === null ? null : splitGrid(measured, direction));
  }

  private notifyLayout(): void {
    this.onLayout?.();
  }

  private async spawn(id: string, cwd: string, grid: FitGrid | null = null): Promise<void> {
    const pane = this.panes.get(id);
    if (pane === undefined) return;
    const born = servable(grid, this.hostCeiling());
    const outcome = await openShell(this.repo, cwd, null, born);
    if (outcome._tag === 'Unanswered') {
      pane.noteProblem(outcome.problem);
      return;
    }
    if (outcome._tag === 'Refused') {
      this.notices.refusal(outcome.error);
      this.close(id);
      return;
    }
    try {
      const listing = await this.repo.record.key(outcome.execution).refresh({ throwOnError: true });
      if (listing === undefined) return;
      if (this.panes.get(id) === pane) {
        pane.bind(outcome.execution, { born });
        this.notifyLayout();
      }
    } catch (error) {
      this.notices.refusal(error);
      this.close(id);
    }
  }

  close(id: string, confirmed = false): void {
    const pane = this.panes.get(id);
    if (pane === undefined) return;
    const address = pane.address;
    const ended = pane.ending !== null;
    const next = neighbourPane(this.layout, id, 1);
    const remaining = removePane(this.layout, id);

    if (remaining === null) {
      this.onEmpty();
      return;
    }
    if (!confirmed && address !== null && !ended && this.asksClose?.(id, address) === true) return;
    this.panes.delete(id);
    if (this.expanded === id) this.expanded = null;
    if (this.renaming === id) this.renaming = null;
    if (this.dragging === id) this.dragging = null;
    const life = this.lives.get(id);
    this.lives.delete(id);
    void life?.close();

    this.layout = remaining;
    if (this.active === id && next !== null && next !== id) this.point(next);
    this.refit();
    this.notifyLayout();
    if (address !== null && !ended) void this.stop(address);
  }

  detach(id: string): ExecutionAddress | null {
    const pane = this.panes.get(id);
    const address = pane?.address ?? null;
    if (pane === undefined || address === null) return null;
    const next = neighbourPane(this.layout, id, 1);
    const remaining = removePane(this.layout, id);
    if (remaining === null) return null;
    this.panes.delete(id);
    if (this.expanded === id) this.expanded = null;
    if (this.renaming === id) this.renaming = null;
    if (this.dragging === id) this.dragging = null;
    const life = this.lives.get(id);
    this.lives.delete(id);
    void life?.close();

    this.layout = remaining;
    if (this.active === id && next !== null && next !== id) this.point(next);
    this.refit();
    this.notifyLayout();
    return address;
  }

  move(sourceId: string, targetId: string, zone: DropZone): void {
    const moved = movePane(this.layout, sourceId, targetId, zone);
    if (moved === this.layout) return;
    this.layout = moved;
    this.expanded = null;
    this.refit();
    this.notifyLayout();
  }

  equalise(): void {
    if (this.expanded !== null || this.count < 2) return;
    this.layout = equalise(this.layout);
    this.refit();
    this.current?.focus();
    this.notifyLayout();
  }

  retitle(id: string, label: string | null): void {
    const pane = this.panes.get(id);
    if (pane === undefined) return;
    const named = label === null ? '' : label.trim();
    pane.label = named === '' ? null : named;
    this.notifyLayout();
  }

  expand(id: string): void {
    if (this.count < 2 || !this.panes.has(id)) return;
    this.expanded = this.expanded === id ? null : id;
    if (this.expanded !== null) this.activate(id);
    this.refit();
  }

  step(direction: 1 | -1): boolean {
    if (this.count < 2) return false;
    if (this.expanded !== null) {
      this.expanded = null;
      this.refit();
    }
    const next = neighbourPane(this.layout, this.active, direction);
    if (next !== null) this.activate(next);
    return true;
  }

  resize(path: SplitPath, ratio: number): void {
    const resized = setRatio(this.layout, path, ratio);
    if (resized === this.layout) return;
    this.layout = resized;
    this.notifyLayout();
  }

  refit(): void {
    if (this.refitFrame !== null) return;
    this.refitFrame = requestAnimationFrame(() => {
      this.refitFrame = null;
      for (const pane of this.panes.values()) pane.fit();
    });
  }

  followMouse(id: string, buttons: number): void {
    if (!this.appearance.paneStyle().focusFollowsMouse) return;
    if (buttons !== 0 || this.active === id) return;
    if (typeof document !== 'undefined' && !document.hasFocus()) return;
    this.activate(id);
  }

  perform(act: TerminalAct, pane: TerminalPane): boolean {
    if (paneAct(act, pane, this.appearance)) return true;
    switch (act._tag) {
      case 'split-right':
        void this.split(pane, 'row');
        return true;
      case 'split-down':
        void this.split(pane, 'column');
        return true;
      case 'close-pane':
        this.close(pane.id);
        return true;
      case 'focus-next':
        return this.step(1);
      case 'focus-previous':
        return this.step(-1);
      case 'equalize':
        this.equalise();
        return true;
      case 'expand-pane':
        this.expand(pane.id);
        return true;
      case 'set-title':
        this.renaming = pane.id;
        return true;
      case 'clear-title':
        this.retitle(pane.id, null);
        return true;
      case 'toggle-terminals':
      case 'new-tab':
      case 'reopen-tab':
      case 'rename-tab':
      case 'close-all-tabs':
      case 'next-tab':
      case 'previous-tab':
      case 'previous-recent-tab':
      case 'select-index':
        return this.onStripAct(act);
      default:
        return false;
    }
  }

  private raise(id: string): TerminalPane {
    const life = this.scope.child(`TerminalPane:${id}`);
    this.lives.set(id, life);
    const pane = TerminalPane.start(life, { id, ground: this, program: this.program });
    this.panes.set(id, pane);
    return pane;
  }

  private reveal(on: boolean): void {
    if (this.shown === on) return;
    this.shown = on;
    if (on) {
      this.attention = false;
      this.policy.scheduleReveal();
    }
    for (const [id, pane] of this.panes) pane.reveal(on && this.visible(id));
  }

  private async stop(address: ExecutionAddress): Promise<void> {
    const operationId = crypto.randomUUID();
    try {
      await this.repo.stop.run({ ...address, operationId, cause: 'explicit-stop' }, { throwOnError: true });
    } catch (error) {
      const stood = await readOperation(this.repo, operationId);
      if (stood._tag === 'Landed') return;
      this.notices.refusal(error);
    }
  }
}

export const treeHolds = (node: PaneNode, id: string): boolean => hasPane(node, id);

function restoreLayout(tree: PaneNode): { layout: PaneNode; leaves: [stored: string, fresh: string][]; first: string } {
  const leaves: [stored: string, fresh: string][] = [];
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === 'pane') {
      const fresh = crypto.randomUUID();
      leaves.push([node.id, fresh]);
      return paneNode(fresh);
    }
    return { ...node, children: [walk(node.children[0]), walk(node.children[1])] };
  };
  const layout = walk(tree);
  return { layout, leaves, first: leaves[0]?.[1] ?? crypto.randomUUID() };
}

export type OperationOutcome =
  | { readonly _tag: 'Landed'; readonly execution?: ExecutionAddress }
  | { readonly _tag: 'Undecided' }
  | { readonly _tag: 'Free' }
  | { readonly _tag: 'Unread'; readonly problem: string };

export async function readOperation(repo: Repo, operationId: string): Promise<OperationOutcome> {
  let answer;
  try {
    answer = await repo.operation.key(operationId).refresh({ throwOnError: true });
  } catch (error) {
    return { _tag: 'Unread', problem: error instanceof Error ? error.message : String(error) };
  }
  if (answer === undefined) return { _tag: 'Unread', problem: 'the operation key answered nothing' };
  if (answer._tag === 'Whole') {
    const state = answer.state;
    if (state._tag === 'Admitted') return { _tag: 'Landed', execution: state.execution };
    if (state._tag === 'Settled') {
      return state.execution === undefined ? { _tag: 'Landed' } : { _tag: 'Landed', execution: state.execution };
    }
    return state._tag === 'Pending' || state._tag === 'Uncertain' ? { _tag: 'Undecided' } : { _tag: 'Free' };
  }
  const digest = answer.digest;
  if (digest.phase === 'admitted' || digest.phase === 'settled') {
    return digest.execution === undefined ? { _tag: 'Landed' } : { _tag: 'Landed', execution: digest.execution };
  }
  return digest.phase === 'pending' || digest.phase === 'uncertain' ? { _tag: 'Undecided' } : { _tag: 'Free' };
}

export type StartOutcome =
  | { readonly _tag: 'Started'; readonly execution: ExecutionAddress; readonly operation: string; readonly retain: null }
  | { readonly _tag: 'Unanswered'; readonly problem: string; readonly retain: string }
  | { readonly _tag: 'Refused'; readonly error: unknown; readonly retain: null };

export async function openShell(repo: Repo, cwd: string, retained: string | null, grid: FitGrid | null = null): Promise<StartOutcome> {
  if (retained !== null) {
    const stood = await readOperation(repo, retained);
    const answered = shellOf(stood, retained);
    if (answered !== null) return answered;
  }
  const operationId = crypto.randomUUID();
  try {
    const answer = await repo.start.run(
      {
        operationId,
        cwd,
        transport: 'pty',
        lifetime: 'held',
        geometry: grid === null ? undefined : { rows: grid.rows, columns: grid.cols },
      },
      { throwOnError: true },
    );
    const at = answer === undefined ? undefined : startedAt(answer);
    return at === undefined
      ? { _tag: 'Unanswered', problem: 'the shell was asked for and nothing answered with its address', retain: operationId }
      : { _tag: 'Started', execution: at, operation: operationId, retain: null };
  } catch (error) {
    const stood = await readOperation(repo, operationId);
    if (stood._tag === 'Free') return { _tag: 'Refused', error, retain: null };
    return shellOf(stood, operationId) ?? { _tag: 'Refused', error, retain: null };
  }
}

export function splitGrid(source: FitGrid, direction: SplitDirection): FitGrid {
  return direction === 'row'
    ? { cols: Math.max(1, Math.floor(source.cols / 2)), rows: source.rows }
    : { cols: source.cols, rows: Math.max(1, Math.floor(source.rows / 2)) };
}

export function servable(grid: FitGrid | null, ceiling: FitGrid | null): FitGrid | null {
  if (grid === null || ceiling === null) return null;
  return { cols: Math.min(grid.cols, ceiling.cols), rows: Math.min(grid.rows, ceiling.rows) };
}

function shellOf(stood: OperationOutcome, operationId: string): StartOutcome | null {
  if (stood._tag === 'Landed') {
    return stood.execution === undefined
      ? { _tag: 'Unanswered', problem: 'the shell this act opened cannot be named', retain: operationId }
      : { _tag: 'Started', execution: stood.execution, operation: operationId, retain: null };
  }
  if (stood._tag === 'Undecided') {
    return {
      _tag: 'Unanswered',
      problem: 'the shell asked for is unanswered, and asking again would open a second one',
      retain: operationId,
    };
  }
  if (stood._tag === 'Unread') {
    return {
      _tag: 'Unanswered',
      problem: `the shell asked for could not be read back — ${stood.problem}`,
      retain: operationId,
    };
  }
  return null;
}

export function startedAt(answer: StartAnswer): ExecutionAddress | undefined {
  const key = answer.operation;
  if (key._tag === 'Digest') return key.digest.execution;
  const state = key.state;
  if (state._tag === 'Admitted') return state.execution;
  return state._tag === 'Settled' ? state.execution : undefined;
}

type StartAnswer = Exclude<Awaited<ReturnType<Repo['start']['run']>>, undefined>;
