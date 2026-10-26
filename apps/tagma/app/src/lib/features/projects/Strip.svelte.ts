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
  private readonly listed = $derived(this.known(this.members ?? this.seed()));
  private readonly ordered = $derived(this.known(this.order));
  private readonly lately = $derived.by(() => {
    const held = new Set(this.listed.map((project) => project.id));
    const current = this.workspace.activeId;
    return this.known(this.here.filter((id) => id === current || held.has(id)));
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
    return this.workspace.projects.filter((project) => !project.global).length >= 2;
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
    const members = this.projects;
    const held = new Set(members.map((project) => project.id));
    const current = this.workspace.activeId;
    const first = this.recent.filter((project) => held.has(project.id) || project.id === current);
    const met = new Set(first.map((project) => project.id));
    return [...first, ...members.filter((project) => !met.has(project.id))];
  }

  remove(projectId: number): void {
    const stored = this.read();
    this.write({ ...this.base(stored), members: (stored?.members ?? this.seed()).filter((id) => id !== projectId) });
  }

  move(projectId: number, before: number | null): void {
    const stored = this.read();
    const held = stored?.members ?? this.seed();
    if (!held.includes(projectId) || projectId === before) return;
    const members = held.filter((id) => id !== projectId);
    const at = before === null ? -1 : members.indexOf(before);
    members.splice(at === -1 ? members.length : at, 0, projectId);
    this.write({ ...this.base(stored), members });
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
