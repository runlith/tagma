import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { Router } from '@runlith/layer/Router';
import { Effect } from 'effect';
import type { ProjectPrefetch } from '$lib/features/projects/Prefetch.js';
import type { ThreadsRepo } from '$lib/features/threads/Repo.js';
import {
  type BesideOffer,
  NavigationFailed,
  type OpenTarget,
  type ProjectEntry,
  ProjectUnknown,
  registered,
  type ShellPort,
  type ShellRefusal,
  SurfaceNotDeclared,
  ThreadGone,
  type ThreadAddress,
  ThreadUnreadable,
  projectOf,
} from '$lib/features/workspace/ShellOps.js';
import type { Surface, SurfaceRegistry } from '$lib/features/workspace/surface.js';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { Visits } from '$lib/features/workspace/Visits.svelte.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';
import { markProjectSwitch } from '$lib/features/projects/switchRecord.js';

export abstract class RoutedShell implements ShellPort {
  constructor(
    protected readonly router: Router,
    protected readonly workspace: Workspace,
    protected readonly visits: Visits,
    protected readonly registry: SurfaceRegistry,
    protected readonly addresses: Addresses,
    protected readonly threads: ThreadsRepo,
    protected readonly prefetch: ProjectPrefetch,
  ) {}

  abstract besideOffer(thread: ThreadAddress): BesideOffer;

  abstract openThread(thread: ThreadAddress, target: OpenTarget): Effect.Effect<void, ShellRefusal>;

  openProject(projectId: number, entry: ProjectEntry): Effect.Effect<void, ShellRefusal> {
    return registered(this.workspace, projectId).pipe(
      Effect.tap((project) =>
        Effect.tryPromise({
          try: () => this.prefetch.of(project),
          catch: (error) =>
            new NavigationFailed({ message: `${project.name} could not load: ${error instanceof Error ? error.message : String(error)}` }),
        }),
      ),
      Effect.flatMap((project) => {
        const clear = markProjectSwitch(project.id, entry);
        return this.route(this.visits.resume(project)).pipe(Effect.ensuring(Effect.sync(clear)));
      }),
    );
  }

  abstract openPane(kind: string, id: string | null): Effect.Effect<void, ShellRefusal>;

  revealSurface = Effect.fnUntraced(function* (this: RoutedShell, surface: Surface): Effect.fn.Return<void, ShellRefusal> {
    if (this.registry.find(surface) === undefined) {
      return yield* new SurfaceNotDeclared({ surface, message: `Surface "${surface}" is not declared.` });
    }
    const project = this.workspace.contextProject;
    if (project === null) return yield* new ProjectUnknown({ projectId: null, message: 'No project is open to show a section of.' });
    yield* this.route(this.visits.href(project, surface));
  });

  protected route(href: string): Effect.Effect<void, NavigationFailed> {
    return Effect.tryPromise({
      try: () => this.router.goto(href),
      catch: (error) => new NavigationFailed({ message: error instanceof Error ? error.message : String(error) }),
    });
  }

  protected standing = Effect.fnUntraced(function* (this: RoutedShell, thread: ThreadAddress): Effect.fn.Return<Project, ShellRefusal> {
    const project = yield* projectOf(this.workspace, thread);
    const answer = yield* Effect.tryPromise({
      try: () =>
        this.threads.list
          .key({ project: String(thread.projectId), selection: { ids: thread.threadId, set: 'all', limit: '1' } })
          .refresh({ throwOnError: true }),
      catch: (error) =>
        new ThreadUnreadable({ threadId: thread.threadId, message: error instanceof Error ? error.message : String(error) }),
    });
    if (answer === undefined || answer.status !== 'rows') {
      return yield* new ThreadUnreadable({ threadId: thread.threadId, message: 'The server did not answer for this thread.' });
    }
    if (!answer.rows.some((row) => row.id === thread.threadId)) {
      return yield* new ThreadGone({ threadId: thread.threadId, message: `Thread ${thread.threadId} no longer exists.` });
    }
    return project;
  });

  protected inItsProject = Effect.fnUntraced(function* (this: RoutedShell, thread: ThreadAddress): Effect.fn.Return<void, ShellRefusal> {
    const project = yield* this.standing(thread);
    const clear = markProjectSwitch(project.id, 'thread');
    yield* this.route(this.addresses.thread(thread.threadId, project.name)).pipe(Effect.ensuring(Effect.sync(clear)));
  });
}
