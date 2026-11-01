import type { Router } from '@runlith/layer/Router';
import { Effect } from 'effect';
import type { ProjectPrefetch } from '$lib/features/projects/Prefetch.js';
import type { ThreadsRepo } from '$lib/features/threads/Repo.js';
import {
  type BesideOffer,
  type OpenTarget,
  PaneUnavailable,
  type ShellRefusal,
  type ThreadAddress,
} from '$lib/features/workspace/ShellOps.js';
import type { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { THREAD_PANE } from '$lib/features/threads/seats/pane.js';
import type { ThreadOpening, ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import type { SidePanes } from '../panes/SidePanes.svelte.js';
import { RoutedShell } from './RoutedShell.js';

const REFUSED = {
  undeclared: (noun: string) => `Tagma has no “${noun}” tab.`,
  inadmissible: (noun: string) => `This ${noun} cannot open as a tab beside itself.`,
  nowhere: () => 'No tabs beside are on screen to open it in.',
} as const;

export class DesktopShell extends RoutedShell {
  constructor(
    router: Router,
    workspace: Workspace,
    visits: Visits,
    registry: SurfaceRegistry,
    addresses: Addresses,
    threads: ThreadsRepo,
    prefetch: ProjectPrefetch,
    private readonly panes: SidePanes,
    private readonly seats: ThreadSeats,
  ) {
    super(router, workspace, visits, registry, addresses, threads, prefetch);
  }

  besideOffer(thread: ThreadAddress): BesideOffer {
    if (this.workspace.activeId === null) return 'open';
    const standing = this.seats.standing(thread.threadId);
    return standing.kind === 'main' ? 'none' : standing.kind === 'beside' ? 'show' : 'open';
  }

  openThread(thread: ThreadAddress, target: OpenTarget): Effect.Effect<void, ShellRefusal> {
    if (target === 'main' || this.workspace.activeId === null) return this.inItsProject(thread);
    const home = thread.projectId === this.workspace.activeId ? null : thread.projectId;
    return Effect.andThen(
      this.standing(thread),
      Effect.suspend(() => this.answered(THREAD_PANE, this.seats.open({ home, threadId: thread.threadId }))),
    );
  }

  openPane(kind: string, id: string | null): Effect.Effect<void, ShellRefusal> {
    return Effect.suspend(() => this.answered(kind, this.panes.open({ kind, id })));
  }

  private answered(kind: string, opening: ThreadOpening): Effect.Effect<void, ShellRefusal> {
    if (opening.kind !== 'refused') return Effect.void;
    const noun = this.panes.kinds.find(kind)?.noun ?? kind;
    return Effect.fail(new PaneUnavailable({ kind, message: REFUSED[opening.reason](noun) }));
  }
}
