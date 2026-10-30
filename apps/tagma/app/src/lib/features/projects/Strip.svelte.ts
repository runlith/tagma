import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { Workspace } from '../workspace/Selection.svelte.js';
import { Visits } from '../workspace/Visits.svelte.js';

const STORAGE_KEY = 'tagma.strip';

export const STRIP_VIEWS = ['dock', 'tabs'] as const;
export type StripView = (typeof STRIP_VIEWS)[number];

type Stored = {
  readonly members: readonly number[];
  readonly recent: readonly number[];
  readonly view: StripView;
};

const ids = (value: unknown): readonly number[] | null =>
  Array.isArray(value) && value.every((id) => Number.isInteger(id)) ? [...new Set(value as number[])] : null;

export class ProjectStrip extends Service<ProjectStrip>()('ProjectStrip', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new ProjectStrip(yield* Workspace, yield* Visits, platform.storage.local);
  }

  private members = $state.raw<readonly number[] | null>(null);
  private order = $state.raw<readonly number[]>([]);
  private shown = $state<StripView>('dock');
  private entered: number | null = null;
  private here = $state.raw<readonly number[]>([]);
  private readonly listed = $derived(this.tiles(this.members ?? this.seed()));
  private readonly ordered = $derived(this.known(this.order));
  private readonly lately = $derived.by(() => {
    const held = new Set(this.listed.map((tile) => tile.id));
    const current = this.workspace.activeId;
    return this.known(this.here.filter((id) => id === current || held.has(this.workspace.tileIdOf(id))));
  });

  constructor(
    private readonly workspace: Workspace,
    private readonly visits: Visits,
    private readonly storage: PlatformStorage,
  ) {
    super();
    const stored = this.read();
    this.members = stored?.members ?? null;
    this.order = stored?.recent ?? [];
    this.shown = stored?.view ?? 'dock';
    $effect(() => storage.watch(STORAGE_KEY, () => this.adopt()));
    $effect(() => {
      const current = workspace.activeId;
      if (current === this.entered) return;
      this.entered = current;
      if (current !== null) untrack(() => this.enter(current));
    });
    $effect(() => {
      const back = (): void => {
        const current = workspace.activeId;
        if (current !== null) this.enter(current);
      };
      window.addEventListener('focus', back);
      return () => window.removeEventListener('focus', back);
    });
  }

  get view(): StripView {
    return this.shown;
  }

  get visible(): boolean {
    const folders = this.workspace.projects.filter((project) => project.kind === 'folder');
    return new Set(folders.map((project) => this.workspace.tileIdOf(project.id))).size >= 2;
  }

  entry(tile: Project): Project {
    const members = this.workspace.groupOf(tile.id)?.members;
    if (members === undefined || tile.kind !== 'group') return tile;
    const held = new Set(members.map((member) => member.id));
    const last = this.order.find((id) => held.has(id));
    return members.find((member) => member.id === last) ?? members[0] ?? tile;
  }

  include(projectIds: readonly number[]): void {
    const stored = this.read();
    const held = stored?.members ?? this.seed();
    const missing = projectIds.filter((id) => !held.includes(id));
    if (missing.length > 0) this.write({ ...this.base(stored), members: [...held, ...missing] });
  }

  get projects(): readonly Project[] {
    return this.listed;
  }

  get recent(): readonly Project[] {
    return this.ordered;
  }

  get visited(): readonly Project[] {
    return this.lately;
  }

  get cycle(): readonly Project[] {
    const tiles = this.projects;
    const held = new Set(tiles.map((tile) => tile.id));
    const current = this.workspace.activeTileId;
    const first = this.tiles(this.order).filter((tile) => held.has(tile.id) || tile.id === current);
    const met = new Set(first.map((tile) => tile.id));
    return [...first, ...tiles.filter((tile) => !met.has(tile.id))];
  }

  remove(tileId: number): void {
    const stored = this.read();
    const members = (stored?.members ?? this.seed()).filter((id) => this.workspace.tileIdOf(id) !== tileId && id !== tileId);
    this.write({ ...this.base(stored), members });
  }

  move(tileId: number, before: number | null): void {
    const stored = this.read();
    const held = stored?.members ?? this.seed();
    const blocks = new Map<number, number[]>();
    for (const id of held) {
      const tile = this.workspace.tileIdOf(id);
      const block = blocks.get(tile);
      if (block === undefined) blocks.set(tile, [id]);
      else block.push(id);
    }
    const moving = blocks.get(tileId);
    if (moving === undefined || tileId === before) return;
    const order = [...blocks.keys()].filter((tile) => tile !== tileId);
    const at = before === null ? -1 : order.indexOf(before);
    order.splice(at === -1 ? order.length : at, 0, tileId);
    this.write({ ...this.base(stored), members: order.flatMap((tile) => blocks.get(tile) ?? []) });
  }

  show(view: StripView): void {
    const stored = this.read();
    this.write({ ...this.base(stored), view });
  }

  private enter(projectId: number): void {
    const stored = this.read();
    const members = stored?.members ?? this.seed();
    this.order = [projectId, ...this.order.filter((id) => id !== projectId)];
    this.here = [projectId, ...this.here.filter((id) => id !== projectId)];
    this.write({ ...this.base(stored), members: members.includes(projectId) ? members : [...members, projectId], recent: this.order });
  }

  private adopt(): void {
    const stored = this.read();
    const members = stored?.members ?? null;
    if ((members?.join() ?? null) !== (this.members?.join() ?? null)) this.members = members;
    this.shown = stored?.view ?? 'dock';
  }

  private base(stored: Stored | null): Stored {
    return { members: stored?.members ?? this.seed(), recent: stored?.recent ?? this.order, view: stored?.view ?? this.shown };
  }

  private seed(): readonly number[] {
    return this.workspace.projects.filter((project) => this.visits.knows(project)).map((project) => project.id);
  }

  private known(order: readonly number[]): readonly Project[] {
    return order.flatMap((id) => this.workspace.find(id) ?? []);
  }

  private tiles(order: readonly number[]): readonly Project[] {
    const seen = new Set<number>();
    return this.known(order).flatMap((project) => {
      const tile = this.workspace.tileOf(project);
      if (seen.has(tile.id)) return [];
      seen.add(tile.id);
      return [tile];
    });
  }

  private read(): Stored | null {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const document = parsed as Record<string, unknown>;
    const members = ids(document.members);
    if (members === null) return null;
    return {
      members,
      recent: ids(document.recent) ?? [],
      view: STRIP_VIEWS.find((view) => view === document.view) ?? 'dock',
    };
  }

  private write(next: Stored): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.members = next.members;
    this.shown = next.view;
  }
}
