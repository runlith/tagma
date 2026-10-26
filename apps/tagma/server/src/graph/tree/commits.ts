import { existsSync } from 'node:fs';
import { Cause, Clock, Context, Effect, Semaphore } from 'effect';
import { inArray, sql } from 'drizzle-orm';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { type SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { OwnGitFailed, runGitBytes } from '../../platform/git/ownGit.js';
import { event } from '../store/tables.js';
import { session } from '../../platform/store/writers.js';
import type { ActEntry } from '../contract/service/acts.js';
import type { Git } from '@runlith/git/Git';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type GraphCommitPolicy, graphCommit } from '../settings.js';
import { CHECKOUT_DIRECTORY, GRAPH_COMMIT_PREFIX, inGraphTree, WORKFLOWS_DIRECTORY } from '../contract/wire/storage.js';
import { settleIndex } from '../../platform/git/settle.js';
import { placesOf } from '../../platform/git/places.js';
import { captureTree, type OwedSettlement, owedOf, publishToCheckout } from './batch.js';

const PATHSPEC = [CHECKOUT_DIRECTORY, `:(exclude)${CHECKOUT_DIRECTORY}/${WORKFLOWS_DIRECTORY}`] as const;

const PUBLISH_ATTEMPTS = 3;

const NAMED_SESSIONS = 6;

const QUIET_MS = 10_000;

const CEILING_MS = 120_000;

const RETRY_FIRST_MS = 1_000;

const RETRY_CAP_MS = 300_000;

const GRAPH_COMMIT_KEY = graphCommit.id;

export type SyncAnswer =
  | {
      readonly kind: 'committed';
      readonly commit: string;
      readonly sessions: readonly string[];
      readonly files: number;
    }
  | { readonly kind: 'clean' }
  | { readonly kind: 'held'; readonly reason: 'detached' | 'merge' };

export type TreeCommitReport = {
  readonly commit: string | null;
  readonly sessions: readonly string[];
  readonly files: number;
};

export const TreeCommits = Context.Reference<
  | {
      readonly mark: (entries: readonly ActEntry[], paths: readonly string[]) => Effect.Effect<void>;
      readonly carry: (paths: readonly string[]) => Effect.Effect<void>;
      readonly commit: Effect.Effect<SyncAnswer, OwnGitFailed | StoreFailure>;
      readonly uncommitted: Effect.Effect<number, OwnGitFailed>;
    }
  | undefined
>('tagma/graph/TreeCommits', {
  defaultValue: () => undefined,
});

export type SyncRefusal = 'not-a-team-tree' | 'commit-off' | 'graph-commit' | 'tree-mid-merge' | 'no-branch';

export const syncGraph = Effect.fnUntraced(function* ({
  commits,
  policy,
}: {
  readonly commits: Context.Service.Shape<typeof TreeCommits>;
  readonly policy: Effect.Effect<GraphCommitPolicy, StoreFailure>;
}): Effect.fn.Return<TreeCommitReport, GateRefusal<SyncRefusal> | StoreFailure> {
  if (commits === undefined) {
    return yield* new GateRefusal('not-a-team-tree', "tagma's own git versions this tree and commits every act into it", [
      'nothing to sync — read what it committed with `tagma files log <block>`',
    ]);
  }
  if ((yield* policy) === 'off') {
    return yield* new GateRefusal('commit-off', `${GRAPH_COMMIT_KEY} is off: tagma commits nothing in this project`, [
      `set ${GRAPH_COMMIT_KEY} to manual — then this act commits when you ask`,
      `set ${GRAPH_COMMIT_KEY} to auto — then a settled batch commits itself`,
    ]);
  }
  const outcome = yield* Effect.mapError(commits.commit, (error) =>
    error instanceof GateRefusal
      ? error
      : error._tag === 'OwnGitFailed'
        ? error.ran
          ? new GateRefusal('graph-commit', `git ${error.op}: ${error.message}`, [
              'read what git said and clear it; the tree keeps the batch until a commit carries it',
            ])
          : new GateRefusal('graph-commit', `git could not run (${error.op}): ${error.message}`, [
              'nothing about the tree was read: the process that runs git is not serving — read the execution host, and commit again once a shell answers',
            ])
        : error,
  );
  if (outcome.kind === 'held') {
    return yield* outcome.reason === 'merge'
      ? new GateRefusal('tree-mid-merge', 'a merge stands open in this checkout', [
          "conclude it in the project's own git — the graph commits again once it is",
        ])
      : new GateRefusal('no-branch', 'HEAD is detached, so a graph commit would be reachable from nothing', [
          'check out a branch — the tree keeps its changes across the switch',
        ]);
  }
  return outcome.kind === 'clean'
    ? { commit: null, sessions: [], files: 0 }
    : { commit: outcome.commit, sessions: outcome.sessions, files: outcome.files };
});

export type TreeCommitsOptions = {
  readonly git: Git['Service'];
  readonly checkout: string;
  readonly treeRoot: string;
  readonly db: StoreDb<'graph'>;
  readonly permit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly policy: Effect.Effect<GraphCommitPolicy, StoreFailure>;
  readonly fork: (effect: Effect.Effect<void>) => unknown;
  readonly identity: SessionIdentity['Service'];
};

export function treeCommits(options: TreeCommitsOptions): NonNullable<Context.Service.Shape<typeof TreeCommits>> {
  const { git, checkout, treeRoot, db, permit, policy, fork, identity } = options;
  let pending: { position: number | null; sessions: Set<number>; since: number; last: number } | null = null;
  let settling = false;
  let written = new Set<string>();
  let failures = 0;
  let owed: OwedSettlement | null = null;
  const serial = Semaphore.makeUnsafe(1);

  const spokenFor = Effect.fnUntraced(function* (ids: readonly number[]) {
    if (ids.length === 0) return [];
    const rows = yield* db.select({ harness: session.harness, key: session.key }).from(session).where(inArray(session.id, ids));
    return [...new Set(rows.map((row) => sessionName(row, identity)))];
  });

  const subject = (position: number, names: readonly string[]): string => {
    const shown = names.slice(0, NAMED_SESSIONS);
    const more = names.length - shown.length;
    const who = shown.length === 0 ? '' : ` (${shown.join(', ')}${more > 0 ? `, +${more}` : ''})`;
    return `${GRAPH_COMMIT_PREFIX}${position}${who}`;
  };

  const dirt = Effect.map(
    runGitBytes(git, 'graph-dirty', [
      '-C',
      checkout,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--',
      ...PATHSPEC,
    ]),
    (out) =>
      out
        .split('\0')
        .filter((record) => record.length > 3)
        .map((record) => record.slice(3)),
  );

  const settleOwed: Effect.Effect<void, OwnGitFailed> = Effect.suspend(() => {
    const standing = owed;
    if (standing === null) return Effect.void;
    return Effect.flatMap(placesOf(git, checkout), (places) => settleIndex(git, checkout, places, standing.ref, standing.entries)).pipe(
      Effect.mapError((failure) =>
        failure._tag === 'OwnGitFailed' ? failure : new OwnGitFailed({ op: 'graph-settle', message: failure.message, ran: true }),
      ),
      Effect.map((settlement) => {
        const left = owedOf(standing.entries, settlement);
        owed = left.length === 0 ? null : { ref: standing.ref, entries: left };
      }),
    );
  });

  const commit: NonNullable<Context.Service.Shape<typeof TreeCommits>>['commit'] = serial.withPermits(1)(
    Effect.gen(function* () {
      if (!existsSync(treeRoot)) return { kind: 'clean' } as const;
      yield* settleOwed;
      const taken = pending;
      for (let attempt = 1; ; attempt += 1) {
        const paths = yield* dirt;
        if (paths.length === 0 && written.size === 0) {
          if (pending === taken) pending = null;
          return { kind: 'clean' } as const;
        }
        let acted = new Set<string>();
        const capture = yield* permit(
          Effect.suspend(() => {
            acted = written;
            written = new Set();
            return captureTree(
              checkout,
              [...paths, ...[...acted].map((path) => `${CHECKOUT_DIRECTORY}/${path}`)],
              (path) => !inGraphTree(path),
            );
          }),
        ).pipe(
          Effect.tapError(() => Effect.sync(() => acted.forEach((path) => written.add(path)))),
          Effect.mapError((failure) => new OwnGitFailed({ op: 'graph-capture', message: failure.message, ran: false })),
        );
        const restore = Effect.sync(() => acted.forEach((path) => written.add(path)));
        const position =
          taken?.position ??
          (yield* db
            .select({ id: sql<number>`coalesce(max(id), 0)` })
            .from(event)
            .get())?.id ??
          0;
        const names = yield* spokenFor(taken === null ? [] : [...taken.sessions]).pipe(Effect.tapError(() => restore));
        const published = yield* Effect.uninterruptible(
          publishToCheckout(git, checkout, capture, { message: `${subject(position, names)}\n`, author: 'tagma' }),
        ).pipe(Effect.tapError(() => restore));
        if (published.kind === 'moved' || published.kind === 'held') yield* restore;
        if (published.kind === 'moved' && attempt < PUBLISH_ATTEMPTS) continue;
        if (published.kind === 'moved') {
          return yield* new OwnGitFailed({
            op: 'graph-publish',
            message: `the branch moved under ${PUBLISH_ATTEMPTS} graph commits in a row`,
            ran: true,
          });
        }
        if (published.kind === 'held') return published;
        if (pending === taken) pending = null;
        if (published.kind === 'clean') return published;
        if (published.unsettled !== null) {
          yield* Effect.logWarning('a graph commit landed and the checkout index kept some of its paths as they stood', {
            tree: treeRoot,
            reason: published.unsettled,
          });
        }
        if (published.owed.entries.length > 0) {
          const kept = owed === null ? [] : owed.entries;
          const landed = new Set(published.owed.entries.map((entry) => entry.path));
          owed = { ref: published.owed.ref, entries: [...kept.filter((entry) => !landed.has(entry.path)), ...published.owed.entries] };
        }
        if (owed !== null) yield* due([], []);
        return { kind: 'committed', commit: published.commit, sessions: names, files: published.files } as const;
      }
    }),
  );

  const settle = Effect.gen(function* () {
    for (;;) {
      for (;;) {
        const open = pending;
        if (open === null) return;
        const due = Math.min(open.last + QUIET_MS, open.since + CEILING_MS);
        const now = yield* Clock.currentTimeMillis;
        if (now >= due) break;
        yield* Effect.sleep(due - now);
      }
      const outcome = yield* Effect.exit(Effect.flatMap(policy, (chosen) => (chosen === 'auto' ? commit : Effect.succeed(null))));
      if (outcome._tag === 'Success') {
        failures = 0;
        if (outcome.value === null || outcome.value.kind === 'held' || pending === null) return;
        continue;
      }
      if (Cause.hasInterrupts(outcome.cause)) return yield* Effect.interrupt;
      failures += 1;
      const waitMs = Math.min(RETRY_FIRST_MS * 2 ** (failures - 1), RETRY_CAP_MS);
      yield* Effect.logWarning('a graph commit did not land: the tree keeps its batch and commits again', {
        tree: treeRoot,
        failures,
        retryInMs: waitMs,
        cause: outcome.cause,
      });
      yield* Effect.sleep(waitMs);
    }
  }).pipe(Effect.ensuring(Effect.sync(() => (settling = false))), Effect.withSpan('TreeCommits.settle', { root: true }));

  const due = Effect.fnUntraced(function* (entries: readonly ActEntry[], paths: readonly string[]) {
    const now = yield* Clock.currentTimeMillis;
    for (const path of paths) written.add(path);
    const sessions = pending?.sessions ?? new Set<number>();
    let position = pending?.position ?? null;
    for (const entry of entries) {
      if (entry.sessionId !== null) sessions.add(entry.sessionId);
      position = Math.max(position ?? 0, entry.id);
    }
    pending = { position, sessions, since: pending?.since ?? now, last: now };
    if (settling) return;
    settling = true;
    fork(settle);
  });

  return {
    mark: due,
    carry: (paths) => due([], paths),
    commit,
    uncommitted: Effect.map(dirt, (paths) => new Set(paths).size),
  };
}
