import { makeCoverageStore } from '../../workspace/store/coverage.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Path } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { type DemoState, demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

import { RootId } from '../../workspace/contract/wire/ids.js';
import { environmentLedger, fileRootStore, repositoryRegistry, repositoryStore, rootRegistry } from '../../workspace/testing/doubles.js';
import { makeBackendRegistry } from '../../workspace/environments/backends.js';
import { makeEnvironmentStore } from '../../workspace/store/environments.js';
import { makeEnvironmentUseStore } from '../../workspace/store/environmentUses.js';
import { makeEnvironmentUses } from '../../workspace/environments/uses.js';
import { makeHostEnvironment } from '../../executions/host/environmentBackend.js';
import { makeMachineWorld } from '../../executions/worlds/machine.js';
import type { BranchTwins } from '../../graph/contract/service/branchTwins.js';
import { makeProvisionalBranches } from './provisional.js';
import { BranchRefs } from '../contract/service/refs.js';
import { makeGitBranchRefs } from '../git/refs.js';
import { ProgramFailed, ProgramUnavailable, type GitHubCli, type ProgramEnded, type ProgramFailure } from '@runlith/github/GitHubCli';
import { makeBranchRenames } from './rename.js';
import { idleThreads, openGate, worktreeCreator, worktreeStore } from '../testing/doubles.js';
import { Git } from '@runlith/git/Git';
import { BranchTwinning } from '../contract/service/branches.js';
import { WorktreeThreads } from '../contract/service/finishingGate.js';
import { FinishingGate } from '../contract/service/retirement.js';
import { WorktreeRecords } from '../contract/service/worktrees.js';
import { WorktreeIntents } from '../contract/service/intents.js';
import { Settings } from '../../settings/contract/service/values.js';

const machineWorld = makeMachineWorld(() => null);

const sh = (cwd: string, args: readonly string[]) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(args, { cwd }), (run) =>
      run.status === 0 ? Effect.succeed(run.stdout.trim()) : Effect.die(new Error(`git ${args.join(' ')}: ${run.stderr}`)),
    ),
  );

const has = (bare: string, branch: string) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: bare }), (run) =>
      run.status === 0 || run.status === 1 ? Effect.succeed(run.status === 0) : Effect.die(new Error(run.stderr)),
    ),
  );

type PullRequest = { number: number; owner: string; head: string; base: string; title: string; body: string; state: 'OPEN' | 'CLOSED' };

const GITHUB = 'https://github.com/acme/app';

const github = (repo = 'github.com/acme/app') => {
  const pulls: PullRequest[] = [];
  const opened = (pull: Omit<PullRequest, 'number' | 'state'>) => {
    pulls.push({ ...pull, number: pulls.length + 1, state: 'OPEN' });
  };
  const ended = (stdout: string, status = 0): Effect.Effect<ProgramEnded, ProgramFailed> =>
    status === 0
      ? Effect.succeed({ status: 0, stdout, stderr: '' })
      : Effect.fail(new ProgramFailed({ phase: 'exit', status, detail: stdout, stdout, stderr: stdout }));
  const flag = (args: readonly string[], name: string): string | undefined => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const urlOf = (pull: PullRequest) => `https://github.com/acme/app/pull/${pull.number}`;
  const gh = (args: readonly string[]): Effect.Effect<ProgramEnded, ProgramFailure> => {
    if (args[0] === '--version') return ended('gh version 2');
    if (args[0] === 'repo' && args[1] === 'view') return args[2] === repo ? ended('{}') : ended('not found', 1);
    if (args[0] === 'pr' && args[1] === 'list') {
      const open = pulls.filter((pull) => pull.state === 'OPEN' && pull.head === flag(args, '--head'));
      return ended(
        JSON.stringify(
          open.map((pull) => ({
            number: pull.number,
            url: urlOf(pull),
            title: pull.title,
            body: pull.body,
            baseRefName: pull.base,
            isDraft: false,
            headRefName: pull.head,
            headRepositoryOwner: { login: pull.owner },
            isCrossRepository: pull.owner !== 'acme',
          })),
        ),
      );
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      const [owner, head] = (flag(args, '--head') ?? '').includes(':')
        ? (flag(args, '--head') ?? '').split(':')
        : ['acme', flag(args, '--head') ?? ''];
      const pull: PullRequest = {
        number: pulls.length + 1,
        owner: owner ?? 'acme',
        head: head ?? '',
        base: flag(args, '--base') ?? '',
        title: flag(args, '--title') ?? '',
        body: flag(args, '--body') ?? '',
        state: 'OPEN',
      };
      pulls.push(pull);
      return ended(`${urlOf(pull)}\n`);
    }
    if (args[0] === 'pr' && args[1] === 'close') {
      const pull = pulls.find((one) => one.number === Number(args[2]));
      if (pull === undefined) return ended('no pull request', 1);
      pull.state = 'CLOSED';
      return ended('');
    }
    return ended(`unexpected gh ${args.join(' ')}`, 1);
  };
  return { gh, pulls, opened };
};

const composed = Effect.fnUntraced(function* (demo: DemoState, gh: GitHubCli['run'], twins: BranchTwins = (_place, rename) => rename) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const liveGit = yield* Git;
  const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'worktree-renames-' });
  const access = yield* environmentLedger(
    makeBackendRegistry({ backends: [yield* makeHostEnvironment({ records: makeEnvironmentStore({ db }), anchor, world: machineWorld })] }),
    makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) }),
    units,
  );
  const state = yield* access.inspect('host');
  if (state.binding === null) return yield* Effect.die(`the host answered for no identity: ${state.reason}`);
  const acquired = yield* access.acquireActive({
    binding: state.binding,
    consumer: { kind: 'test', id: 'renames' },
    requires: ['files', 'exec'],
  });
  const records = yield* worktreeStore(makeCoverageStore({ db }));
  const roots = yield* rootRegistry(yield* fileRootStore(db, units), files, paths, state.binding.namespaceId, records);
  const repositories = yield* repositoryRegistry(yield* repositoryStore(db, units), liveGit, files, paths, state.binding.namespaceId);
  const worktrees = yield* worktreeCreator({ intents: records, records, repositories, roots, git: liveGit, files, paths, units });
  const { id: projectId, root: project } = demo.project('renames');
  const bare = yield* files.makeTempDirectoryScoped({ prefix: 'renames-remote-' });
  yield* sh(bare, ['init', '-q', '--bare']);
  const store = yield* repositories.register({ path: project, projectId });
  const trunk = yield* sh(project, ['symbolic-ref', '--short', 'HEAD']);
  const make = Effect.fnUntraced(function* (branch: string) {
    const operationId = RequestKey.make(branch.replaceAll('/', '-'));
    yield* worktrees.prepare({
      intent: {
        operationId,
        projectId,
        repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
        destination: paths.join(paths.dirname(project), `${paths.basename(project)}-${operationId}`),
        mode: { kind: 'new-branch', branch, start: trunk },
      },
      acquired,
    });
    const made = yield* worktrees.execute({ operationId, projectId, acquired });
    if (made.rootId === null) return yield* Effect.die(`the creation ended ${made.status}`);
    return { rootId: RootId.make(made.rootId), path: made.destination };
  });
  const services = Context.make(MachineUnits, units).pipe(
    Context.add(WorktreeRecords, records),
    Context.add(WorktreeIntents, records),
    Context.add(Git, liveGit),
    Context.add(FileSystem.FileSystem, files),
    Context.add(BranchTwinning, { twins }),
    Context.add(WorktreeThreads, idleThreads()),
    Context.add(FinishingGate, openGate),
    Context.add(Settings, demo.graph.settings),
  );
  const branches = yield* makeProvisionalBranches.pipe(
    Effect.provideContext(services),
    Effect.provideService(BranchRefs, yield* makeGitBranchRefs()),
  );
  const renames = yield* makeBranchRenames({ branches, gh: (args, cwd) => gh(args, cwd) }).pipe(Effect.provideContext(services));
  const recorded = (rootId: RootId) => units.read((unit) => records.byRoot(rootId, unit));
  const rename = (rootId: RootId, name: string, remote?: 'keep' | 'move') => Effect.result(renames.rename(projectId, rootId, name, remote));
  return { make, project, bare, recorded, rename, records, units, branches };
});

layer(demoGraphLayer({ repos: ['renames'] }).pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, Path.layer))), {
  excludeTestServices: true,
})('branch renames', (it) => {
  it.effect(
    'a worktree never pushed is renamed in place: spaces become dashes, the prefix is kept, the title rename is off, and a taken or unspellable name refuses',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { make, recorded, rename, records, units, branches } = yield* composed(demo, () =>
            Effect.fail(new ProgramUnavailable({ detail: 'gh is absent' })),
          );
          const tree = yield* make('tagma/thread-a1b2c3');
          yield* units.write('WorktreeRenames', (unit) => records.nameAfter(tree.rootId, 'thread-1', unit));
          yield* make('tagma/taken');

          const renamed = yield* rename(tree.rootId, '  Fix  login  ');

          expect(renamed._tag === 'Success' ? renamed.success : renamed.failure).toEqual({
            rootId: tree.rootId,
            from: 'tagma/thread-a1b2c3',
            to: 'tagma/Fix-login',
            remote: { status: 'unpublished' },
          });
          expect(yield* sh(tree.path, ['symbolic-ref', '--short', 'HEAD'])).toBe('tagma/Fix-login');
          expect((yield* recorded(tree.rootId))?.branch).toBe('tagma/Fix-login');
          expect(yield* branches.titled('thread-1', 'Another Title')).toBeNull();

          const taken = yield* rename(tree.rootId, 'tagma/taken');
          const invalid = yield* rename(tree.rootId, 'a..b');
          const same = yield* rename(tree.rootId, 'Fix login');
          expect(
            [taken, invalid, same].map((one) =>
              one._tag === 'Failure' && one.failure._tag === 'WorktreeFinishRefused' ? one.failure.reason : one._tag,
            ),
          ).toEqual(['name-taken', 'name-invalid', 'name-unchanged']);
          expect(yield* sh(tree.path, ['symbolic-ref', '--short', 'HEAD'])).toBe('tagma/Fix-login');
        }),
      ),
    120_000,
  );

  it.effect(
    'on a remote that is not GitHub the branch is renamed here only, and the remote and upstream keep the old name',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { make, project, bare, rename } = yield* composed(demo, github().gh);
          yield* sh(project, ['remote', 'add', 'origin', bare]);
          const tree = yield* make('tagma/first');
          yield* sh(tree.path, ['push', '-q', '-u', 'origin', 'tagma/first']);

          const renamed = yield* rename(tree.rootId, 'second');

          expect(renamed._tag === 'Success' ? renamed.success.remote.status : renamed.failure).toBe('kept');
          expect([yield* has(bare, 'tagma/first'), yield* has(bare, 'tagma/second')]).toEqual([true, false]);
          expect(yield* sh(tree.path, ['config', 'branch.tagma/second.merge'])).toBe('refs/heads/tagma/first');
        }),
      ),
    120_000,
  );

  it.effect(
    'a GitHub branch with no open pull request moves on its remote: the new name is pushed and tracked, and the old one Tagma pushed is deleted',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const hub = github();
          const { make, project, bare, rename } = yield* composed(demo, hub.gh);
          yield* sh(project, ['remote', 'add', 'origin', GITHUB]);
          yield* sh(project, ['config', 'remote.origin.pushurl', bare]);
          const pushed = yield* make('tagma/pushed-here');
          yield* sh(pushed.path, ['push', '-q', '-u', 'origin', 'tagma/pushed-here']);
          const foreign = yield* make('tagma/pushed-elsewhere');
          const files = yield* FileSystem.FileSystem;
          const other = yield* files.makeTempDirectoryScoped({ prefix: 'renames-other-' });
          yield* sh(other, ['clone', '-q', bare, '.']);
          yield* sh(other, ['fetch', '-q', project, 'tagma/pushed-elsewhere:tagma/pushed-elsewhere']);
          yield* sh(other, ['push', '-q', 'origin', 'tagma/pushed-elsewhere']);
          yield* sh(foreign.path, ['fetch', '-q', bare, '+refs/heads/tagma/pushed-elsewhere:refs/remotes/origin/tagma/pushed-elsewhere']);
          yield* sh(foreign.path, ['branch', '-q', '-u', 'origin/tagma/pushed-elsewhere']);

          const mine = yield* rename(pushed.rootId, 'renamed-here');
          const theirs = yield* rename(foreign.rootId, 'renamed-elsewhere');

          expect(mine._tag === 'Success' ? mine.success.remote : mine.failure).toEqual({
            status: 'moved',
            remote: 'origin',
            pullRequest: null,
            old: { deleted: true, reason: null },
          });
          expect([yield* has(bare, 'tagma/pushed-here'), yield* has(bare, 'tagma/renamed-here')]).toEqual([false, true]);
          expect(yield* sh(pushed.path, ['config', 'branch.tagma/renamed-here.merge'])).toBe('refs/heads/tagma/renamed-here');
          expect(theirs._tag === 'Success' && theirs.success.remote.status === 'moved' ? theirs.success.remote.old.deleted : theirs).toBe(
            false,
          );
          expect([yield* has(bare, 'tagma/pushed-elsewhere'), yield* has(bare, 'tagma/renamed-elsewhere')]).toEqual([true, true]);
        }),
      ),
    120_000,
  );

  it.effect(
    'an open GitHub pull request stays on the old name by default, and moving it opens a new one and closes the old with a link',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const hub = github();
          const { make, project, bare, rename } = yield* composed(demo, hub.gh);
          yield* sh(project, ['remote', 'add', 'origin', GITHUB]);
          yield* sh(project, ['config', 'remote.origin.pushurl', bare]);
          const tree = yield* make('tagma/feature');
          yield* sh(tree.path, ['push', '-q', '-u', 'origin', 'tagma/feature']);
          hub.opened({ owner: 'acme', head: 'tagma/feature', base: 'main', title: 'Feature', body: 'Why' });

          const kept = yield* rename(tree.rootId, 'kept');

          expect(kept._tag === 'Success' ? kept.success.remote : kept.failure).toMatchObject({
            status: 'kept',
            branch: 'tagma/feature',
            pullRequest: { number: 1 },
          });
          expect([yield* has(bare, 'tagma/feature'), yield* has(bare, 'tagma/kept')]).toEqual([true, false]);

          const moved = yield* rename(tree.rootId, 'moved', 'move');

          expect(moved._tag === 'Success' ? moved.success.remote : moved.failure).toMatchObject({
            status: 'moved',
            pullRequest: { opened: { number: 2 }, closed: { number: 1 }, closing: null },
            old: { deleted: true },
          });
          const [old, fresh] = hub.pulls;
          expect([old?.state, fresh?.state, fresh?.head, fresh?.base, fresh?.title]).toEqual([
            'CLOSED',
            'OPEN',
            'tagma/moved',
            'main',
            'Feature',
          ]);
          expect([yield* has(bare, 'tagma/feature'), yield* has(bare, 'tagma/moved')]).toEqual([false, true]);
          expect(yield* sh(tree.path, ['config', 'branch.tagma/moved.merge'])).toBe('refs/heads/tagma/moved');
        }),
      ),
    120_000,
  );

  it.effect(
    'a record that moves while git renames undoes the rename, and the worktree stays on its old branch',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          let moving: Effect.Effect<void> = Effect.void;
          const { make, rename, recorded, records, units } = yield* composed(
            demo,
            () => Effect.fail(new ProgramUnavailable({ detail: 'gh is absent' })),
            (_place, renaming) => Effect.andThen(moving, renaming),
          );
          const tree = yield* make('tagma/before');
          moving = Effect.orDie(
            Effect.asVoid(units.write('WorktreeRenames', (unit) => records.renamed(tree.rootId, 'tagma/before', 'tagma/elsewhere', unit))),
          );

          const refused = yield* rename(tree.rootId, 'after');

          expect(
            refused._tag === 'Failure' && refused.failure._tag === 'WorktreeFinishRefused' ? refused.failure.reason : refused._tag,
          ).toBe('off-branch');
          expect(yield* sh(tree.path, ['symbolic-ref', '--short', 'HEAD'])).toBe('tagma/before');
          expect((yield* recorded(tree.rootId))?.branch).toBe('tagma/elsewhere');
        }),
      ),
    120_000,
  );

  it.effect(
    "a branch tracking a branch of another name, and a stranger's pull request from a branch of the same name, leave the remote alone",
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const hub = github();
          const { make, project, bare, rename } = yield* composed(demo, hub.gh);
          yield* sh(project, ['remote', 'add', 'origin', GITHUB]);
          yield* sh(project, ['config', 'remote.origin.pushurl', bare]);
          yield* sh(project, ['push', '-q', 'origin', 'HEAD:refs/heads/develop']);
          const tracking = yield* make('tagma/tracking');
          yield* sh(tracking.path, ['branch', '-q', '-u', 'origin/develop']);
          const shared = yield* make('tagma/shared');
          yield* sh(shared.path, ['push', '-q', '-u', 'origin', 'tagma/shared']);
          hub.opened({ owner: 'stranger', head: 'tagma/shared', base: 'main', title: 'Theirs', body: '' });

          const local = yield* rename(tracking.rootId, 'tracking-renamed');
          const moved = yield* rename(shared.rootId, 'shared-renamed', 'move');

          expect(local._tag === 'Success' ? local.success.remote.status : local.failure).toBe('unpublished');
          expect(yield* has(bare, 'develop')).toBe(true);
          expect(moved._tag === 'Success' ? moved.success.remote : moved.failure).toMatchObject({ status: 'moved', pullRequest: null });
          expect(hub.pulls.map((pull) => pull.state)).toEqual(['OPEN']);
        }),
      ),
    120_000,
  );
});
