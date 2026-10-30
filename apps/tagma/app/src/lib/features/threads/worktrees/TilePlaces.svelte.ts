import { SvelteMap } from 'svelte/reactivity';
import type { WorktreeCreation, Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';

export type TileMember = { readonly projectId: number; readonly places: Worktrees };

export type MemberCreation = { readonly projectId: number; readonly creation: WorktreeCreation };

export class TilePlaces {
  private readonly held = new SvelteMap<number, Worktrees>();

  readonly members = $derived.by<readonly TileMember[]>(() =>
    this.ids().flatMap((projectId) => {
      const places = this.of(projectId);
      return places === null ? [] : [{ projectId, places }];
    }),
  );
  readonly others = $derived.by(() => this.ids().filter((projectId) => projectId !== this.own().aim.projectId));
  readonly creations = $derived.by<readonly MemberCreation[]>(() =>
    this.members.flatMap(({ projectId, places }) => places.creations.map((creation) => ({ projectId, creation }))),
  );
  readonly several = $derived.by(
    () => this.creations.length > 0 || this.members.reduce((count, { places }) => count + places.grouped.length, 0) > 1,
  );

  constructor(
    private readonly own: () => Worktrees,
    private readonly ids: () => readonly number[],
  ) {}

  of(projectId: number): Worktrees | null {
    const own = this.own();
    return projectId === own.aim.projectId ? own : (this.held.get(projectId) ?? null);
  }

  hold(projectId: number, places: Worktrees): () => void {
    this.held.set(projectId, places);
    return () => {
      if (this.held.get(projectId) === places) this.held.delete(projectId);
    };
  }
}
