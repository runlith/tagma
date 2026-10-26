import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';

export type DraftWhere =
  | { readonly kind: 'main' }
  | { readonly kind: 'worktree'; readonly rootId: string }
  | { readonly kind: 'new'; readonly base: string | null; readonly name: string | null };

export function placeOfBirth(where: DraftWhere): { worktree?: string; base?: string; worktreeName?: string } {
  if (where.kind === 'worktree') return { worktree: where.rootId };
  if (where.kind === 'new') {
    const name = where.name?.trim() ?? '';
    return {
      worktree: 'new',
      base: where.base ?? undefined,
      worktreeName: name === '' ? undefined : name,
    };
  }
  return {};
}

export async function bornIn<T extends { readonly snapshot: { readonly thread: { readonly id: string } } }>(
  places: Worktrees,
  where: DraftWhere,
  create: () => Promise<T>,
  again: () => void,
  name: string | null = null,
): Promise<T | null> {
  if (where.kind !== 'new') return await create();
  try {
    return await places.placing(where.name?.trim() || 'new worktree', create, (answer) => answer.snapshot.thread.id, again, name);
  } catch {
    return null;
  }
}
