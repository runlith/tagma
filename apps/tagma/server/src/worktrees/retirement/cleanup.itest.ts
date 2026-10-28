import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Effect, FileSystem, Layer, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { WorktreeRows } from '../contract/service/listing.js';
import { WorktreeRetirement } from '../contract/service/retirement.js';
import { RETIREMENT_OPERATIONS } from '../contract/wire/operations/retirement.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { WorktreeRow } from '../contract/wire/rows.js';
import { WorktreeFinishRefused } from '../contract/wire/failures.js';
import { makeCleanupCandidates } from './cleanup.js';

const sh = (cwd: string, args: readonly string[]) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(args, { cwd }), (run) =>
      run.status === 0 ? Effect.succeed(run.stdout.trim()) : Effect.die(new Error(`git ${args.join(' ')}: ${run.stderr}`)),
    ),
  );

const repo = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'worktree-cleanup-' }));
  const root = join(home, 'repo');
  yield* sh(home, ['init', '-q', '-b', 'main', root]);
  yield* files.writeFileString(join(root, '.git', 'config'), '[user]\n\temail = tagma@test\n\tname = tagma\n', { flag: 'a' });
  yield* files.writeFileString(join(root, 'seed'), 'seed\n');
  yield* sh(root, ['add', '-A']);
  yield* sh(root, ['commit', '-qm', 'seed']);
  return { root, home };
});

const daysAgo = (now: Date, days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();

const row = (now: Date, name: string, folder: string, over: Partial<WorktreeRow>): WorktreeRow => ({
  index: 0,
  missing: false,
  head: null,
  headTime: null,
  stateFact: { state: 'untaken', head: null, base: null, baseTime: null, takenAt: null },
  mergeFact: { state: 'untaken', head: null, base: null, baseTime: null, takenAt: null },
  rootId: RootId.make(`root-${name}`),
  kind: 'tagma',
  name,
  folder,
  branch: `tagma/${name}`,
  base: { branch: 'main', commit: 'f'.repeat(40) },
  hue: 1,
  status: 'idle',
  check: 'clean',
  agents: { working: 0, waiting: 0, finished: 0, standing: 0 },
  ahead: 0,
  behind: 0,
  uncommitted: 0,
  reading: 'done',
  diff: null,
  threads: [],
  setup: 'none',
  taskId: null,
  pending: null,
  movedAt: daysAgo(now, 1),
  ...over,
});

layer(Layer.merge(BunFileSystem.layer, liveGitLayer), { excludeTestServices: true })('worktree cleanup', (it) => {
  it.effect(
    'candidates are merged, missing or idle worktrees Tagma made, each with the blockers that keep a bulk deletion off it; a graph commit is no movement',
    () =>
      Effect.gen(function* () {
        const now = new Date(yield* Clock.currentTimeMillis);
        const files = yield* FileSystem.FileSystem;
        const { root, home } = yield* repo;
        yield* sh(root, ['branch', 'tagma/merged']);
        yield* sh(root, ['branch', 'tagma/stale']);
        yield* sh(root, ['branch', 'tagma/busy']);
        yield* sh(root, ['branch', 'tagma/fresh']);
        yield* sh(root, ['switch', '-q', 'tagma/stale']);
        yield* files.writeFileString(join(root, 'stale'), 'only here\n');
        yield* sh(root, ['add', '-A']);
        yield* sh(root, ['commit', '-qm', 'work nobody pushed', `--date=${daysAgo(now, 20)}`]);
        yield* files.makeDirectory(join(root, '.tagma'), { recursive: true });
        yield* files.writeFileString(join(root, '.tagma', 'note.md'), 'a block\n');
        yield* sh(root, ['add', '-A']);
        yield* sh(root, ['commit', '-qm', 'docs(graph): finish a task', `--date=${daysAgo(now, 0)}`]);
        yield* sh(root, ['switch', '-q', 'main']);
        yield* sh(root, ['branch', 'tagma/unreadable', 'tagma/stale']);
        const rows: WorktreeRow[] = [
          row(now, 'merged', root, { status: 'merged' }),
          row(now, 'stale', root, { status: 'ready', ahead: 1, movedAt: daysAgo(now, 20) }),
          row(now, 'unreadable', root, { status: 'unread', reading: 'failed', uncommitted: null, movedAt: daysAgo(now, 20) }),
          row(now, 'busy', root, { status: 'merged', agents: { working: 1, waiting: 0, finished: 0, standing: 1 }, uncommitted: 2 }),
          row(now, 'gone', join(home, 'gone'), { status: 'missing' }),
          row(now, 'fresh', root, { status: 'ready', ahead: 3 }),
          row(now, 'foreign', root, { kind: 'external', status: 'merged' }),
        ];
        const acted: string[] = [];
        const retirement = WorktreeRetirement.of({
          delete: (_projectId, rootId) =>
            rootId === 'root-merged' || rootId === 'root-gone'
              ? Effect.sync(() => {
                  acted.push(`delete ${rootId}`);
                  return {
                    rootId,
                    name: rootId,
                    committed: null,
                    removed: rootId === 'root-merged',
                    threads: { moved: [], kept: [] },
                    ended: [],
                    branch:
                      rootId === 'root-merged'
                        ? { status: 'deleted' as const, name: 'tagma/merged' }
                        : { status: 'kept' as const, name: 'tagma/gone', reason: 'it holds work', commits: [] },
                  };
                })
              : Effect.fail(
                  new WorktreeFinishRefused({ reason: 'root-in-use', message: 'a terminal holds it', unblock: ['end the terminal'] }),
                ),
          place: () => Effect.die('cleanup uses its declared project placement'),
          terms: () => Effect.die('cleanup deletes through the retirement operation'),
        });
        const listing = WorktreeRows.of({
          rows: () => Effect.succeed(rows),
          list: () => Effect.die('cleanup reads the complete rows'),
          subscribe: () => Stream.die('cleanup does not subscribe to rows'),
        });
        const cleanup = yield* makeCleanupCandidates({ place: () => Effect.succeed({ folder: root, base: null }) }).pipe(
          Effect.provideService(WorktreeRows, listing),
          Effect.provideService(WorktreeRetirement, retirement),
        );
        const found = yield* cleanup.candidates(1, 14);
        expect(found.map((one) => [one.name, one.reason, one.blockers])).toEqual([
          ['merged', 'merged', []],
          ['stale', 'idle', [{ kind: 'unpushed', count: 1 }]],
          [
            'unreadable',
            'idle',
            [
              { kind: 'unread', count: 0 },
              { kind: 'unpushed', count: 1 },
            ],
          ],
          [
            'busy',
            'merged',
            [
              { kind: 'agent-running', count: 1 },
              { kind: 'uncommitted', count: 2 },
            ],
          ],
          ['gone', 'missing', []],
        ]);
        expect(found.find((one) => one.name === 'stale')?.idleDays).toBe(20);
        yield* sh(root, ['update-ref', 'refs/remotes/origin/tagma/stale', 'tagma/stale']);
        expect((yield* cleanup.candidates(1, 14)).find((one) => one.name === 'stale')?.blockers).toEqual([]);
        const cleaned = yield* cleanup.clean(
          1,
          ['root-merged', 'root-gone', 'root-busy', 'root-fresh', 'root-stale'].map((id) => RootId.make(id)),
          14,
        );
        expect(cleaned.map((one) => [one.rootId, one.outcome, one.refusal?.code ?? null])).toEqual([
          ['root-merged', 'deleted', null],
          ['root-gone', 'branch-kept', null],
          ['root-busy', 'refused', 'blocked'],
          ['root-fresh', 'refused', 'not-a-candidate'],
          ['root-stale', 'refused', 'root-in-use'],
        ]);
        expect(acted).toEqual(['delete root-merged', 'delete root-gone']);
        const declared: readonly string[] = RETIREMENT_OPERATIONS.clean_up_worktrees.refusals;
        for (const refusal of cleaned.flatMap((each) => (each.refusal === null ? [] : [each.refusal]))) {
          expect(declared).toContain(refusal.code);
          expect(refusal.unblock.length).toBeGreaterThan(0);
        }
      }),
  );
});
