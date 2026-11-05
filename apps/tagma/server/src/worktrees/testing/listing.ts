import { randomUUID } from 'node:crypto';
import { Context, Effect, FileSystem, Option, Queue, Stream } from 'effect';
import { PlatformError, SystemError } from 'effect/PlatformError';
import { NamespaceId } from '@runlith/files/namespace';
import { Git, gitVerb } from '@runlith/git/Git';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { fileRoot, fileRootNamespace, projectRoot } from '../../workspace/store/tables.js';
import { project } from '../../projects/store/table.js';
import { worktreeState } from '../store/tables.js';
import { eq } from 'drizzle-orm';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { CheckoutState } from '../../workspace/contract/wire/checkout.js';
import type { ProjectRoot, ProjectCoverage } from '../../workspace/contract/wire/coverage.js';
import { Coverage } from '../../workspace/contract/service/roots.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { WorktreeRecords, type WorktreeRecord } from '../contract/service/worktrees.js';
import { WorktreeThreads, type ThreadPlacing } from '../contract/service/finishingGate.js';
import { makeMergeChecks } from '../listing/mergeChecks.js';
import { makeActProgress } from '../progress.js';
import { makeWorktreeRowReader } from '../listing/rowReader.js';
import { idleThreads } from './doubles.js';

const NONE = { entries: [], added: 0, removed: 0 };
const BASE = 'f'.repeat(40);
const TREE = 'c'.repeat(40);

export const listingWorld = Effect.fnUntraced(function* (count: number) {
  const nonce = randomUUID();
  const namespaceId = NamespaceId.make(`listing-${nonce}`);
  const rootPath = `/listing-${nonce}`;
  const main: ProjectRoot = { projectId: 7, rootId: RootId.make(`main-${nonce}`), path: rootPath, origin: 'canonical' };
  const records: WorktreeRecord[] = Array.from({ length: count }, (_, index) => ({
    rootId: RootId.make(`${nonce}-${index}`),
    projectId: 7,
    name: `side-${index}`,
    path: `${rootPath}/side-${index}`,
    branch: `side-${index}`,
    baseBranch: 'main',
    baseCommit: BASE,
    origin: 'test',
    hue: index % 6,
    setup: 'none',
    setupDetail: null,
    taskId: null,
    createdAt: new Date(index),
  }));
  const roots: ProjectRoot[] = [
    main,
    ...records.map((record): ProjectRoot => ({ projectId: 7, rootId: record.rootId, path: record.path, origin: 'worktree' })),
  ];
  const coverage: ProjectCoverage = { projectId: 7, namespaceId, rootPath, roots, withheld: [] };
  const absent = new Set<string>();
  const heads = new Map(roots.map((root, index) => [root.rootId, index === 0 ? BASE : index.toString(16).padStart(40, '0')]));
  const stamps = new Map(roots.map((root) => [`${root.path}/.git/index`, 0]));
  const byId = new Map(roots.map((root) => [root.rootId, root]));
  const byRecord = new Map(records.map((record) => [record.rootId, record]));
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* units.write('listing.fixture', (unit) =>
    Effect.gen(function* () {
      yield* unit.run(
        db
          .insert(project)
          .values({ id: 7, name: 'listing-fixture', repoKey: 'listing-fixture', rootPath: '/', createdAt: new Date(0) })
          .onConflictDoNothing(),
      );
      yield* unit.run(db.insert(fileRootNamespace).values({ namespaceId, revision: 1 }));
      yield* unit.run(
        db.insert(fileRoot).values(
          roots.map((root) => ({
            rootId: root.rootId,
            namespaceId,
            path: root.path,
            locationRevision: 1,
            changedRevision: 1,
            witnessProvider: 'fixture',
            witnessFormat: 'path',
            witnessToken: root.path,
            provenance: '{}',
            state: 'active' as const,
          })),
        ),
      );
      yield* unit.run(db.insert(projectRoot).values(roots.map((root) => ({ projectId: 7, rootId: root.rootId, origin: root.origin }))));
    }),
  );
  const info = yield* (yield* FileSystem.FileSystem).stat(import.meta.path);
  const probes = yield* Queue.unbounded<string>();
  const files = FileSystem.makeNoop({
    exists: (path) => Effect.succeed(!absent.has(String(path))),
    stat: (path) =>
      Effect.andThen(
        Queue.offer(probes, String(path)),
        [...absent].some((root) => String(path) === root || String(path).startsWith(`${root}/`))
          ? Effect.fail(
              new PlatformError(new SystemError({ _tag: 'NotFound', module: 'FileSystem', method: 'stat', cause: { code: 'ENOENT' } })),
            )
          : Effect.succeed({ ...info, mtime: Option.some(new Date(stamps.get(String(path)) ?? 0)) }),
      ),
  });
  const starts = yield* Queue.unbounded<string>();
  const readStarts = yield* Queue.unbounded<string>();
  const watches = yield* Queue.unbounded<{ readonly rootId: RootId; readonly held: boolean }>();
  const calls = {
    git: new Map<string, number>(),
    states: new Map<string, number>(),
    followed: new Set<string>(),
    merges: 0,
    active: 0,
    maximum: 0,
  };
  const recorders = new Set<(projectId: number) => void>();
  const threadListeners = new Set<(threadId: string | null) => void>();
  const heldListeners = new Set<(projectId: number) => void>();
  const followers = new Map<string, Set<Queue.Queue<CheckoutState>>>();
  const held = new Set<string>();
  const placed: ThreadPlacing[] = [];
  let merging: Effect.Effect<void> = Effect.void;
  let reading: Effect.Effect<void> = Effect.void;
  const checkout = (rootId: RootId): CheckoutState => {
    const root = byId.get(rootId);
    if (root === undefined) throw new Error(`unknown fixture root ${rootId}`);
    return {
      rootId,
      path: root.path,
      revision: 1,
      head: heads.get(rootId) ?? null,
      ref: rootId === main.rootId ? 'main' : (byRecord.get(rootId)?.branch ?? null),
      upstream: null,
      publishTo: null,
      ahead: null,
      behind: null,
      operation: 'none',
      entries: { staged: NONE, unstaged: NONE, untracked: NONE, unmerged: NONE },
      compare: null,
      unresolvedBase: null,
      coverage: { untracked: 'all', paths: null },
      repository: true,
      incomplete: false,
      stale: false,
      unwatched: false,
      slowStatus: false,
    };
  };
  const state = (rootId: RootId, base?: string) =>
    Effect.sync(() => {
      calls.states.set(rootId, (calls.states.get(rootId) ?? 0) + 1);
      const row = checkout(rootId);
      if (base === undefined || row.head === null) return row;
      const tip = base.startsWith('refs/') ? (heads.get(main.rootId) ?? BASE) : base;
      const added = tip === BASE ? 1 : 2;
      return {
        ...row,
        compare: {
          base: tip,
          mergeBase: tip,
          head: row.head,
          entries: [{ path: 'base-dependent', status: 'modified' as const, lines: { added, removed: 0 } }],
          added,
          removed: 0,
        },
      };
    });
  const git = Git.of({
    run: (args) =>
      Effect.suspend(() => {
        const verb = gitVerb(args);
        calls.git.set(verb, (calls.git.get(verb) ?? 0) + 1);
        const dir = args[args.indexOf('-C') + 1] ?? '.';
        if (absent.has(dir))
          return Effect.succeed({
            status: 128,
            stdout: '',
            stderr: `fatal: cannot change to '${dir}': No such file or directory`,
            overflow: false,
            messageOverflow: false,
          });
        let stdout = '';
        let status = 0;
        if (verb === 'worktree')
          stdout = roots
            .map((root) => {
              const branch = root.rootId === main.rootId ? 'main' : byRecord.get(root.rootId)?.branch;
              return `worktree ${root.path}\0HEAD ${heads.get(root.rootId)}\0branch refs/heads/${branch}\0\0`;
            })
            .join('');
        else if (verb === 'for-each-ref')
          stdout = roots
            .map((root) => {
              const branch = root.rootId === main.rootId ? 'main' : byRecord.get(root.rootId)?.branch;
              return `refs/heads/${branch}\0${heads.get(root.rootId)}\0${1700000000}\n`;
            })
            .join('');
        else if (verb === 'rev-parse' && args.includes('--is-bare-repository')) stdout = `false\n\n${rootPath}/.git\n${dir}/.git\n${dir}\n`;
        else if (verb === 'rev-parse') {
          const names = args.flatMap((arg, index) => (arg === '--git-path' ? [args[index + 1] ?? ''] : []));
          stdout = [`${dir}/.git`, ...names.map((name) => `${dir}/.git/${name}`)].join('\n') + '\n';
        } else if (verb === 'rev-list')
          return Effect.as(Effect.andThen(Queue.offer(readStarts, dir), reading), {
            status: 0,
            stdout: '0\t1\n',
            stderr: '',
            overflow: false,
            messageOverflow: false,
          });
        else if (verb === 'config') status = args.includes('--list') ? 0 : 1;
        else if (verb === 'version') stdout = 'git version 2.50.1\n';
        else if (verb === 'log') stdout = `${TREE}\0\0Fixture\0fixture@test\0${1700000000} +0000\0fixture\n`;
        else if (verb === 'merge-tree') {
          calls.merges += 1;
          calls.active += 1;
          calls.maximum = Math.max(calls.maximum, calls.active);
          return Effect.as(
            Effect.andThen(Queue.offer(starts, dir), merging).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  calls.active -= 1;
                }),
              ),
            ),
            { status: 0, stdout: `${'d'.repeat(40)}\0`, stderr: '', overflow: false, messageOverflow: false },
          );
        } else return Effect.die(`unhandled listing fixture git ${args.join(' ')}`);
        return Effect.succeed({ status, stdout, stderr: '', overflow: false, messageOverflow: false });
      }),
  });
  const recordsPort = WorktreeRecords.of({
    records: () => Effect.succeed(records),
    recordedRoots: () => Effect.succeed(records.map((record) => record.rootId)),
    byRoot: (rootId) => Effect.succeed(byRecord.get(rootId) ?? null),
    record: () => Effect.die('unused'),
    unsettled: () => Effect.die('unused'),
    settle: () => Effect.die('unused'),
    drop: () => Effect.die('unused'),
    nameAfter: () => Effect.die('unused'),
    namedAfter: () => Effect.die('unused'),
    renamed: () => Effect.die('unused'),
    unnamed: () => Effect.die('unused'),
    liveProjects: () => Effect.die('unused'),
  });
  const checkouts = CheckoutRows.of({
    read: state,
    refresh: state,
    follow: Effect.fnUntraced(function* (rootId, base) {
      const observed = base === undefined;
      if (observed) {
        calls.followed.add(rootId);
        yield* Queue.offer(watches, { rootId, held: true });
      }
      const queue = yield* Queue.unbounded<CheckoutState>();
      const set = followers.get(rootId) ?? new Set();
      set.add(queue);
      followers.set(rootId, set);
      yield* Effect.addFinalizer(() =>
        Effect.andThen(
          Effect.sync(() => {
            set.delete(queue);
            if (set.size === 0) {
              if (observed) calls.followed.delete(rootId);
              followers.delete(rootId);
            }
          }),
          observed ? Queue.offer(watches, { rootId, held: false }) : Effect.void,
        ),
      );
      return Stream.fromQueue(queue);
    }),
    subscribe: () => Stream.never,
    checkoutsMoved: () => Stream.never,
    mark: () => Effect.void,
    onMark: () => () => undefined,
    headMoved: () => Stream.never,
    headObserved: () => Stream.never,
  });
  const context = Context.make(Git, git).pipe(
    Context.add(FileSystem.FileSystem, files),
    Context.add(CheckoutRows, checkouts),
    Context.add(WorktreeRecords, recordsPort),
    Context.add(
      WorktreeThreads,
      idleThreads({
        placing: (_projectId, ids) =>
          Effect.succeed(ids === undefined ? [...placed] : placed.filter((placing) => ids.includes(placing.threadId))),
        threadsMoved: (_projectId, listener) => {
          threadListeners.add(listener);
          return () => {
            threadListeners.delete(listener);
          };
        },
      }),
    ),
    Context.add(
      Coverage,
      Coverage.of({
        covered: () => Effect.succeed(coverage),
        cover: () => Effect.succeed(coverage),
        survey: () => Effect.succeed(coverage),
        adopt: () => Effect.die('unused'),
        admit: () => Effect.die('unused'),
        follow: () => Effect.succeed(false),
        followAcross: () => Effect.succeed(false),
        coverAcross: () => Effect.succeed(false),
        onCovered: () => () => undefined,
        recorded: () => undefined,
      }),
    ),
  );
  const open = Effect.gen(function* () {
    const checks = yield* makeMergeChecks;
    const progress = yield* makeActProgress;
    const listing = yield* makeWorktreeRowReader({
      recordMoved: (listener) => {
        recorders.add(listener);
        return () => {
          recorders.delete(listener);
        };
      },
      options: {
        checks,
        progress,
        held: () => held,
        heldMoved: (listener) => {
          heldListeners.add(listener);
          return () => {
            heldListeners.delete(listener);
          };
        },
      },
    });
    return { listing, checks, progress };
  }).pipe(Effect.provide(context));
  return {
    main,
    records,
    roots,
    calls,
    placed,
    held,
    open,
    started: (count: number) => Effect.forEach(Array.from({ length: count }), () => Queue.take(starts), { discard: true }),
    observed: Effect.fnUntraced(function* (rootId: RootId, held: boolean) {
      for (;;) {
        const event = yield* Queue.take(watches);
        if (event.rootId === rootId && event.held === held) return;
      }
    }),
    gate: (work: Effect.Effect<void>) => {
      merging = work;
    },
    gateRead: (work: Effect.Effect<void>) => {
      reading = work;
    },
    reading: Queue.take(readStarts),
    probed: Effect.fnUntraced(function* (path: string) {
      for (;;) {
        if ((yield* Queue.take(probes)) === path) return;
      }
    }),
    retire: (rootId: RootId) =>
      units.write('listing.fixture.retire', (unit) =>
        Effect.gen(function* () {
          yield* unit.run(db.delete(worktreeState).where(eq(worktreeState.rootId, rootId)));
          yield* unit.run(db.delete(projectRoot).where(eq(projectRoot.rootId, rootId)));
          yield* unit.run(db.update(fileRoot).set({ state: 'retired' }).where(eq(fileRoot.rootId, rootId)));
        }),
      ),
    moved: () => {
      for (const listener of recorders) listener(7);
    },
    threadsMoved: () => {
      for (const listener of threadListeners) listener(null);
    },
    heldMoved: () => {
      for (const listener of heldListeners) listener(7);
    },
    missing: (rootId: RootId) => {
      const root = byId.get(rootId);
      if (root !== undefined) absent.add(root.path);
    },
    head: (rootId: RootId, head: string) => {
      heads.set(rootId, head);
    },
    index: (rootId: RootId) => {
      const root = byId.get(rootId);
      if (root !== undefined) {
        const path = `${root.path}/.git/index`;
        stamps.set(path, (stamps.get(path) ?? 0) + 1);
      }
    },
    notify: Effect.fnUntraced(function* (rootId: RootId) {
      for (const queue of followers.get(rootId) ?? []) yield* Queue.offer(queue, checkout(rootId));
    }),
  };
});
