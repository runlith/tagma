import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { Router } from '@runlith/layer/Router';
import { Terminals } from '$lib/features/executions/worktrees/Terminals.svelte.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { CHAT } from '$lib/features/workspace/surface.js';
import { type DraftPlace, MAIN_CHECKOUT } from '../Draft.svelte.js';
import { ThreadList } from '../List.svelte.js';
import { DraftShelf } from '../native/DraftShelf.svelte.js';
import { unbornKey } from '../SlotSelection.svelte.js';

export function draftPlaceOf(row: WorktreePlace): DraftPlace {
  return row.kind === 'main' ? MAIN_CHECKOUT : { kind: 'worktree', rootId: row.rootId };
}

export type WorktreeActs = {
  newAgent(row: WorktreePlace): void;
  newAgentIn(place: DraftPlace, branch: string | null): void;
  openInGit(row: WorktreePlace): void;
  openTerminal(row: WorktreePlace): void;
  copyPath(row: WorktreePlace): void;
};

export function worktreeActs(): WorktreeActs {
  const router = Router.use();
  const addresses = Addresses.use();
  const terminals = Terminals.use();
  const drafts = DraftShelf.use();
  const list = ThreadList.use();
  const workspace = Workspace.use();
  const projectId = ProjectRung.Current.use().projectId;
  const focus = ProjectFocus.use();
  const branchOf = (row: WorktreePlace): string | null => (row.kind === 'main' ? null : row.branch);
  const go = async (href: (project: string) => string): Promise<void> => {
    const project = workspace.find(projectId);
    if (project !== null) await router.goto(href(project.name));
  };
  const newAgentIn = (place: DraftPlace, branch: string | null): void => {
    drafts.place(unbornKey(projectId), place, () => list.titles());
    void go((project) => addresses.place(project, CHAT, null, branch));
  };
  return {
    newAgent: (row) => newAgentIn(draftPlaceOf(row), branchOf(row)),
    newAgentIn,
    openInGit(row) {
      void go((project) => addresses.git('tree', branchOf(row), project));
    },
    openTerminal(row) {
      if (focus.current) void terminals.openIn(row);
      else void go((project) => addresses.place(project, CHAT, null, branchOf(row))).then(() => terminals.openIn(row));
    },
    copyPath(row) {
      void navigator.clipboard.writeText(row.folder).catch(() => undefined);
    },
  };
}
