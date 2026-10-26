import { Context, Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { headAt, troubleOf } from '@runlith/git/repository';
import { MachineStore } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { runGit } from '../../platform/git/ownGit.js';
import { Settings } from '../../settings/contract/service/values.js';
import type { GraphDelivery, TreeDelivery, TreeReady, TreeSync } from '../contract/service/delivery.js';
import { ProjectPolicy, ServedGraphs } from '../contract/service/serving.js';
import { graphCommit } from '../settings.js';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { syncGraph, TreeCommits } from '../tree/commits.js';
import { refusal, refused } from './refusal.js';

export const makeGraphDelivery = Effect.gen(function* () {
  const graphs = yield* ServedGraphs;
  const settings = yield* Settings;
  const policies = yield* ProjectPolicy;
  const machine = yield* MachineStore;
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;

  const pending = Effect.fn('GraphDelivery.pending')(
    function* (projectId: number, checkout: string) {
      const place = { projectId, checkout };
      const held = yield* graphs.holdServed(place);
      if (held !== null) return held;
      const row = (yield* policies.read([projectId])).get(projectId);
      if (row === undefined)
        return yield* new GateRefusal('not-found', `project ${projectId} has no graph policy`, ['read the project registry again']);
      const layout = yield* refused(
        resolveStorageLayout({
          mode: row.storage,
          projectName: row.name,
          ...storageHomes(machine.path),
          worktree: checkout,
        }),
      );
      if (layout.mode !== 'team' && !(yield* files.exists(layout.treeRoot))) return yield* graphs.holdServed(place);
      const root = layout.mode === 'team' ? checkout : layout.treeRoot;
      const paths = layout.mode === 'team' ? CHECKOUT_DIRECTORY : '.';
      const changed = yield* runGit(git, 'graph-pending', ['-C', root, 'status', '--porcelain', '--untracked-files=all', '--', paths]).pipe(
        Effect.mapError((failure) => new GateRefusal('graph-commit', failure.message, ['read the checkout and sync its graph again'])),
      );
      return changed === '' ? yield* graphs.holdServed(place) : yield* graphs.hold({ projectId, cwd: checkout });
    },
    (effect) => Effect.mapError(effect, refusal),
  );

  const sync: TreeSync = Effect.fn('GraphDelivery.sync')(function* (projectId, checkout) {
    const served = yield* pending(projectId, checkout);
    if (served === null) return 'ordinary';
    yield* served.fresh();
    const commits = Context.get(served.context, TreeCommits);
    if (commits === undefined) return 'ordinary';
    const chosen = (yield* settings.read(graphCommit, projectId)).value;
    const remaining =
      chosen === 'off'
        ? yield* commits.uncommitted.pipe(
            Effect.mapError((failure) => new GateRefusal('graph-commit', failure.message, ['read the checkout and sync its graph again'])),
          )
        : 0;
    if (chosen !== 'off') yield* syncGraph({ commits, policy: Effect.succeed(chosen) });
    const head = yield* headAt(served.git, served.checkout).pipe(
      Effect.mapError((failure) => new GateRefusal('graph-commit', troubleOf(failure), ['read the checkout and sync its graph again'])),
    );
    return {
      head: head.commit,
      policy: chosen,
      left: remaining === 0 ? undefined : { reason: 'commit-off' as const, checkout: served.checkout, files: remaining },
    };
  }, Effect.scoped);

  const deliver: TreeDelivery = Effect.fnUntraced(function* (projectId, checkout) {
    const place = { projectId, checkout };
    const served = yield* pending(projectId, checkout);
    if (served === null) return 'ordinary';
    return yield* Effect.gen(function* () {
      const commits = Context.get(served.context, TreeCommits);
      const policy = Effect.map(settings.read(graphCommit, projectId), (resolved) => resolved.value);
      const delivered = commits === undefined || (yield* policy) === 'off' ? 'ordinary' : 'delivered';
      if (delivered === 'delivered' && commits !== undefined) yield* syncGraph({ commits, policy });
      return delivered;
    }).pipe(Effect.ensuring(graphs.release(place)));
  }, Effect.scoped);

  const ready: TreeReady = (projectId, checkout) => Effect.asVoid(pending(projectId, checkout));

  return { ready, sync, deliver } satisfies GraphDelivery;
});
