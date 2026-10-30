import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import type { ThreadStanding, Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import type { DraftPlace, ThreadDraft } from '../Draft.svelte.js';
import type { SlotSelection } from '../SlotSelection.svelte.js';

export type PlaceStanding = ThreadStanding | { readonly kind: 'new'; readonly base: string | null };

type Born = { readonly snapshot: { readonly thread: { readonly id: string } } };

export function placeOfBirth(place: DraftPlace): { worktree?: string; base?: string } {
  if (place.kind === 'worktree') return { worktree: place.rootId };
  if (place.kind === 'new') return { worktree: 'new', base: place.base ?? undefined };
  return {};
}

export class BirthPlace {
  constructor(
    private readonly draft: ThreadDraft,
    private readonly places: Worktrees,
    private readonly selection: SlotSelection,
  ) {}

  get chosen(): DraftPlace {
    return this.draft.place;
  }

  readonly row = $derived.by<WorktreePlace | null>(() => {
    const chosen = this.draft.place;
    if (chosen.kind === 'main') return this.places.main;
    return chosen.kind === 'worktree' ? this.places.byRoot(chosen.rootId) : null;
  });

  readonly standing = $derived.by<PlaceStanding | null>(() => {
    const chosen = this.draft.place;
    if (chosen.kind === 'new') return chosen;
    if (!this.places.known) return null;
    const row = this.row;
    if (row !== null) return { kind: 'row', row };
    if (chosen.kind === 'main') return { kind: 'nowhere' };
    const creation = this.places.creations.find((one) => one.rootId === chosen.rootId);
    return creation === undefined ? { kind: 'deleted', rootId: chosen.rootId, branch: null } : { kind: 'creating', creation };
  });

  pick(place: DraftPlace): void {
    if (this.selection.activeId === null) this.draft.setPlace(place);
  }

  async bear<T extends Born>(
    place: DraftPlace,
    create: () => Promise<T>,
    again: () => void,
    name: string | null = null,
  ): Promise<T | null> {
    if (place.kind !== 'new') return await create();
    try {
      return await this.places.placing('new worktree', create, (answer) => answer.snapshot.thread.id, again, name);
    } catch {
      return null;
    }
  }
}
