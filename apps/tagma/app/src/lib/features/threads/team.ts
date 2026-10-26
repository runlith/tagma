import { TEAM_CEILING } from '@tagma/server/artifacts/contract/wire/feed';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { PageTeam } from '$lib/features/pages/team.js';
import type { ThreadTreeNode } from './forest.js';

export type Crew = { readonly running: readonly ThreadTreeNode[]; readonly total: number };

export const NO_CREW: Crew = { running: [], total: 0 };

const startOf = (row: ThreadListRow): string => row.activeRunStartedAt ?? row.liveSpellStartedAt ?? row.createdAt;

export function crewOf(parent: ThreadTreeNode | undefined): Crew {
  if (parent === undefined) return NO_CREW;
  const running = parent.children
    .filter((child) => child.row.life !== 'idle')
    .toSorted((left, right) => startOf(left.row).localeCompare(startOf(right.row)) || left.row.id.localeCompare(right.row.id));
  return { running, total: parent.children.length };
}

export function pageTeam(lead: ThreadTreeNode | undefined, leadId: string): PageTeam {
  const ids = [leadId];
  const names = new Map<string, string>();
  const queue = lead === undefined ? [] : [lead];
  for (let at = 0; at < queue.length && ids.length < TEAM_CEILING; at += 1) {
    for (const child of queue[at]?.children ?? []) {
      const id = child.row.id;
      if (names.has(id) || id === leadId || ids.length === TEAM_CEILING) continue;
      names.set(id, child.row.name ?? child.row.profileId ?? child.row.agentId);
      ids.push(id);
      queue.push(child);
    }
  }
  return { ids, names };
}
