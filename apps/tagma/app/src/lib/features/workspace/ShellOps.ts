import { Service } from '@runlith/layer/key';
import { Cause, Data, Effect, Exit } from 'effect';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Refusal } from '$lib/wire/refusal.js';
import type { Workspace } from './Selection.svelte.js';
import type { Surface } from './surface.js';

export type ThreadAddress = { readonly projectId: number; readonly threadId: string };

export type OpenTarget = 'main' | 'beside';

export type BesideOffer = 'open' | 'show' | 'none';

export class ProjectUnknown extends Data.TaggedError('ProjectUnknown')<{
  readonly projectId: number | null;
  readonly message: string;
}> {}

export class PaneUnavailable extends Data.TaggedError('PaneUnavailable')<{
  readonly kind: string;
  readonly message: string;
}> {}

export class SurfaceNotDeclared extends Data.TaggedError('SurfaceNotDeclared')<{
  readonly surface: string;
  readonly message: string;
}> {}

export class ThreadGone extends Data.TaggedError('ThreadGone')<{
  readonly threadId: string;
  readonly message: string;
}> {}

export class ThreadUnreadable extends Data.TaggedError('ThreadUnreadable')<{
  readonly threadId: string;
  readonly message: string;
}> {}

export class NavigationFailed extends Data.TaggedError('NavigationFailed')<{ readonly message: string }> {}

export class RegistryUnreadable extends Data.TaggedError('RegistryUnreadable')<{ readonly message: string }> {}

export type ShellRefusal =
  | ProjectUnknown
  | PaneUnavailable
  | SurfaceNotDeclared
  | ThreadGone
  | ThreadUnreadable
  | NavigationFailed
  | RegistryUnreadable;

export type ProjectEntry = 'strip' | 'keys' | 'palette' | 'menu';

export const registered = (workspace: Workspace, projectId: number): Effect.Effect<Project, ProjectUnknown | RegistryUnreadable> =>
  Effect.tryPromise({
    try: () => workspace.projectsOf([projectId]).then(([project]) => project!),
    catch: (error) =>
      error instanceof Refusal && error.code === 'unknown-project'
        ? new ProjectUnknown({ projectId, message: `Project ${projectId} is not registered.` })
        : new RegistryUnreadable({
            message: `The project registry could not be read: ${error instanceof Error ? error.message : String(error)}`,
          }),
  });

export const projectOf = (workspace: Workspace, thread: ThreadAddress): Effect.Effect<Project, ProjectUnknown | ThreadUnreadable> =>
  registered(workspace, thread.projectId).pipe(
    Effect.catchTag('RegistryUnreadable', (unread) =>
      Effect.fail(new ThreadUnreadable({ threadId: thread.threadId, message: unread.message })),
    ),
  );

export interface ShellPort {
  besideOffer(thread: ThreadAddress): BesideOffer;
  openThread(thread: ThreadAddress, target: OpenTarget): Effect.Effect<void, ShellRefusal>;
  openProject(projectId: number, entry: ProjectEntry): Effect.Effect<void, ShellRefusal>;
  openPane(kind: string, id: string | null): Effect.Effect<void, ShellRefusal>;
  revealSurface(surface: Surface): Effect.Effect<void, ShellRefusal>;
}

export class ShellOps extends Service<ShellPort>()('ShellOps', { tier: 'app' }) {}

export type ShellActs = {
  besideOffer(thread: ThreadAddress): BesideOffer;
  openThread(thread: ThreadAddress, target: OpenTarget): Promise<void>;
  openProject(projectId: number, entry: ProjectEntry): Promise<void>;
  openPane(kind: string, id: string | null): Promise<void>;
  revealSurface(surface: Surface): Promise<void>;
};

export function shellActs(ops: ShellPort, notices: Notices): ShellActs {
  const perform = (work: Effect.Effect<void, ShellRefusal>): Promise<void> =>
    Effect.runPromiseExit(work).then((exit) => {
      if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return;
      const failure = Cause.squash(exit.cause);
      notices.error('Could not open', failure instanceof Error ? failure.message : String(failure));
    });
  return {
    besideOffer: (thread) => ops.besideOffer(thread),
    openThread: (thread, target) => perform(ops.openThread(thread, target)),
    openProject: (projectId, entry) => perform(ops.openProject(projectId, entry)),
    openPane: (kind, id) => perform(ops.openPane(kind, id)),
    revealSurface: (surface) => perform(ops.revealSurface(surface)),
  };
}
