import type { MainWindow } from '@tagma/desktop/bridge';
import { Effect } from 'effect';
import type { Addresses } from '$lib/features/workspace/Addresses.js';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { Visits } from '$lib/features/workspace/Visits.svelte.js';
import {
  type BesideOffer,
  PaneUnavailable,
  type ProjectEntry,
  ProjectUnknown,
  registered,
  type OpenTarget,
  type ShellPort,
  type ShellRefusal,
  type ThreadAddress,
  projectOf,
} from '$lib/features/workspace/ShellOps.js';
import { type Surface } from '$lib/features/workspace/surface.js';

export class MainWindowShell implements ShellPort {
  constructor(
    private readonly desktop: MainWindow,
    private readonly workspace: Workspace,
    private readonly visits: Visits,
    private readonly addresses: Addresses,
  ) {}

  openProject(projectId: number, _entry: ProjectEntry): Effect.Effect<void, ShellRefusal> {
    return Effect.map(registered(this.workspace, projectId), (project) => this.desktop.reveal(this.visits.resume(project.name)));
  }

  besideOffer(): BesideOffer {
    return 'none';
  }

  openThread = Effect.fnUntraced(function* (
    this: MainWindowShell,
    thread: ThreadAddress,
    _target: OpenTarget,
  ): Effect.fn.Return<void, ShellRefusal> {
    const project = yield* projectOf(this.workspace, thread);
    this.desktop.reveal(this.addresses.thread(thread.threadId, project.name));
  });

  openPane(kind: string, _id: string | null): Effect.Effect<void, ShellRefusal> {
    return Effect.fail(new PaneUnavailable({ kind, message: 'A window of its own opens no side pane; the main window does.' }));
  }

  revealSurface = Effect.fnUntraced(function* (this: MainWindowShell, surface: Surface): Effect.fn.Return<void, ShellRefusal> {
    const project = this.workspace.contextProject;
    if (project === null) return yield* new ProjectUnknown({ projectId: null, message: 'No project is open to show a section of.' });
    this.desktop.reveal(this.addresses.place(project.name, surface, null, null));
  });
}
