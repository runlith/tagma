import { Effect, FileSystem, Option, Path, Schema, Stream } from 'effect';
import type { PlaceRefusal } from '../contract/wire/refusals.js';
import { commitFilesAt, logAt, type ComparedRow } from '@runlith/git/history';
import { commitOf, headAt, troubleOf, type GitAnswerInvalid, type GitRefused, type GitUnreadable } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { actingGit } from '../../platform/git/ownGit.js';
import { page, pageRows, readCursor, walkQuestion } from '@runlith/paging';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { GateRefusal, type GitRefusal, cursorRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { CHECKOUT_HISTORY, COMMIT_FILES } from '../contract/wire/checkoutReads.js';
import { Coverage } from '../contract/service/roots.js';
import type { ProjectCoverage, ProjectRoot, ProjectRootFailure } from '../contract/wire/coverage.js';
import type { RootId } from '../contract/wire/ids.js';
import { CheckoutHistory, type CheckoutCaller, type CheckoutPlaces } from '../contract/service/checkouts.js';
import { CheckoutPaths, type PlaceUnread } from '../contract/service/checkoutPaths.js';
import { withinCheckout } from '../repositories/listing.js';
import { projectRootRefusal } from '../roots/refusal.js';

const checkoutPlaceRefusal = (failure: ProjectRootFailure): GateRefusal<PlaceRefusal> => projectRootRefusal(failure);

const position = Schema.Tuple([Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))]);

const HISTORY_WALK = {
  operation: 'read_checkout_history',
  order: CHECKOUT_HISTORY.order,
  selection: Schema.Struct({
    projectId: Schema.Number,
    rootId: Schema.String,
    path: Schema.NullOr(Schema.String),
    grep: Schema.NullOr(Schema.String),
    head: Schema.NullOr(Schema.String),
  }),
  key: position,
};

const COMMIT_WALK = {
  operation: 'read_commit',
  order: COMMIT_FILES.order,
  selection: Schema.Struct({
    projectId: Schema.Number,
    rootId: Schema.String,
    commit: Schema.String,
    thread: Schema.NullOr(Schema.String),
  }),
  key: position,
};

const unplaced = (failure: PlaceUnread): GateRefusal<PlaceRefusal> =>
  new GateRefusal('root-inconclusive', `${failure.path} could not be placed among this machine's checkouts: ${failure.reason}`, [
    'read the reason above; a checkout two projects share is read from one of them',
    'ask again once the project registry and the checkout answer',
  ]);

const absent = (named: string | undefined): GateRefusal<'not-found'> =>
  new GateRefusal(
    'not-found',
    named === undefined ? 'This project covers no checkout to read.' : `No checkout of a project on this machine answers to ${named}.`,
    [
      "name a registered root's id, or an absolute path inside a checkout of a registered project",
      'omit it to read the checkout this call stands in',
    ],
  );

const LOG_RECORD = 16_384;

const COMMIT_CAPTURE = 16_000_000;

const weighOf = (entries: readonly ComparedRow[]): { readonly added: number; readonly removed: number } =>
  entries.reduce(
    (sum, entry) => (entry.lines === 'binary' ? sum : { added: sum.added + entry.lines.added, removed: sum.removed + entry.lines.removed }),
    { added: 0, removed: 0 },
  );

const WALK_TOO_LONG = 'ask for fewer commits: this walk passed the size it declared';

const COMMIT_TOO_WIDE = "this commit's listing passed the size one reading declares: read its paths with git yourself";

const gitRefusal = (failure: GitUnreadable | GitRefused | GitAnswerInvalid, incomplete: string = WALK_TOO_LONG): GateRefusal<GitRefusal> =>
  failure._tag === 'GitRefused'
    ? new GateRefusal('git-refused', troubleOf(failure), ['read what git said above and clear it, then ask again'])
    : failure._tag === 'GitAnswerInvalid'
      ? new GateRefusal('git-incomplete', troubleOf(failure), [incomplete])
      : new GateRefusal('git-unreadable', troubleOf(failure), ['read what git said above and run that command yourself to see why']);

export type GitCheckoutReads = CheckoutHistory['Service'] & CheckoutPlaces['Service'];

export const makeGitCheckoutReads = Effect.gen(function* () {
  const coverage = yield* Coverage;
  const checkouts = yield* CheckoutPaths;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const git = actingGit(yield* Git, 'checkout-history');

  const reader = CheckoutHistory.of({
    history: Effect.fn('CheckoutHistory.history')(function* (caller, asked, graphAuthor) {
      const continuing = asked.cursor === undefined ? undefined : yield* walks.recall(HISTORY_WALK, asked.cursor);
      if (continuing !== undefined && continuing.projectId !== caller.projectId) return yield* cursorRefusal('cursor-stale');
      const path = asked.path ?? continuing?.path ?? null;
      const grep = asked.grep ?? continuing?.grep ?? null;
      const carried = asked.path === undefined && continuing !== undefined;
      const place = yield* placeOf(caller, asked.root ?? (carried ? continuing.rootId : undefined));
      const head =
        carried && continuing.head !== null ? continuing.head : (yield* Effect.mapError(headAt(git, place.path), gitRefusal)).commit;
      const question = walkQuestion(HISTORY_WALK, { projectId: caller.projectId, rootId: place.rootId, path, grep, head });
      const continued = asked.cursor === undefined ? undefined : readCursor(asked.cursor, question);
      if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
      const offset = continued === undefined ? 0 : continued.at[0];
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return yield* cursorRefusal('bad-cursor');
      const size = pageRows(asked.limit, CHECKOUT_HISTORY, ceilingOf(CHECKOUT_HISTORY));
      const commits =
        head === null
          ? []
          : yield* Effect.mapError(
              logAt(git, place.path, {
                range: head,
                skip: offset,
                max: size + 1,
                paths: path === null ? undefined : [path],
                grep: grep ?? undefined,
                capture: (size + 1) * LOG_RECORD,
              }),
              gitRefusal,
            );
      const cut = page({
        rows: commits.map((commit, index) => ({ commit, position: offset + index + 1 })),
        asked: size,
        keyOf: (row) => [row.position],
        question,
        total: null,
      });
      return {
        rootId: place.rootId,
        path,
        grep,
        commits: cut.rows.map(({ commit }) => ({
          sha: commit.sha,
          parents: commit.parents,
          author: commit.author,
          date: commit.date,
          subject: commit.subject,
          graph: commit.email === graphAuthor,
        })),
        shown: cut.shown,
        total: cut.total,
        next: cut.next,
        complete: cut.complete,
      };
    }),

    commit: Effect.fn('CheckoutHistory.commit')(function* (caller, asked, overlay) {
      const remembered = asked.cursor === undefined ? undefined : yield* walks.recall(COMMIT_WALK, asked.cursor);
      if (remembered !== undefined && remembered.projectId !== caller.projectId) return yield* cursorRefusal('cursor-stale');
      const place = yield* placeOf(caller, asked.root ?? remembered?.rootId);
      const sha = yield* Effect.mapError(commitOf(git, place.path, asked.commit, { capture: LOG_RECORD }), (failure) =>
        gitRefusal(failure),
      );
      if (sha === null) {
        return yield* new GateRefusal('not-found', `${asked.commit} names no commit in this checkout`, [
          'name a commit the checkout holds, as read_checkout_history spells it',
        ]);
      }
      const thread = asked.thread ?? remembered?.thread ?? null;
      const question = walkQuestion(COMMIT_WALK, { projectId: caller.projectId, rootId: place.rootId, commit: sha, thread });
      const continued = asked.cursor === undefined ? undefined : readCursor(asked.cursor, question);
      if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
      const offset = continued === undefined ? 0 : continued.at[0];
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return yield* cursorRefusal('bad-cursor');
      const [commit] = yield* Effect.mapError(logAt(git, place.path, { range: sha, max: 1, capture: LOG_RECORD }), (failure) =>
        gitRefusal(failure),
      );
      if (commit === undefined) {
        return yield* new GateRefusal('git-unreadable', `git log printed no record for ${sha}, which rev-parse named`, [
          'read what git says about that commit yourself to see why',
        ]);
      }
      const listing = yield* Effect.mapError(commitFilesAt(git, place.path, commit, { capture: COMMIT_CAPTURE }), (failure) =>
        gitRefusal(failure, COMMIT_TOO_WIDE),
      );
      const within =
        thread === null || overlay === undefined
          ? null
          : Option.getOrNull(yield* Effect.option(overlay.pathsOf(place.rootId, place.projectId, thread, sha)));
      const marks = thread === null ? 'unrequested' : within === null ? 'unavailable' : 'applied';
      const placed = listing.entries.map((entry, index) => ({ entry, position: index + 1 }));
      const covered =
        within === null
          ? placed
          : placed.filter(({ entry }) => within.has(entry.path) || (entry.oldPath !== undefined && within.has(entry.oldPath)));
      const size = pageRows(asked.limit, COMMIT_FILES, ceilingOf(COMMIT_FILES));
      const cut = page({
        rows: covered.filter((row) => row.position > offset).slice(0, size + 1),
        asked: size,
        keyOf: (row) => [row.position],
        question,
        total: covered.length,
      });
      const weight = within === null ? listing : weighOf(covered.map(({ entry }) => entry));
      return {
        rootId: place.rootId,
        sha,
        parents: commit.parents,
        author: commit.author,
        date: commit.date,
        subject: commit.subject,
        files: cut.rows.map(({ entry }) => entry),
        marks,
        added: weight.added,
        removed: weight.removed,
        changed: listing.entries.length,
        shown: cut.shown,
        total: covered.length,
        next: cut.next,
        complete: cut.complete,
      };
    }),
  });

  const rootOf = (caller: CheckoutCaller, root?: string): Effect.Effect<RootId, GateRefusal<PlaceRefusal>> =>
    Effect.map(placeOf(caller, root), (place) => place.rootId);

  const placeOf = Effect.fn('CheckoutPlaces.placeOf')(function* (
    caller: CheckoutCaller,
    root?: string,
  ): Effect.fn.Return<ProjectRoot, GateRefusal<PlaceRefusal>> {
    const own = yield* Effect.result(established(caller.projectId));
    const named = root ?? caller.cwd;
    if (own._tag === 'Success' && named !== undefined) {
      const standing = yield* containing(own.success.roots, named);
      if (standing !== null) return standing;
    }
    if (root !== undefined) {
      const across = yield* Effect.mapError(checkouts.rootAcross(root, caller.projectId), unplaced);
      if (across !== null) return across;
    }
    if (own._tag === 'Failure') return yield* checkoutPlaceRefusal(own.failure);
    if (root !== undefined) return yield* absent(root);
    const canonical = own.success.roots.find((row) => row.origin === 'canonical');
    return canonical === undefined ? yield* absent(undefined) : canonical;
  });

  function established(projectId: number): Effect.Effect<ProjectCoverage, ProjectRootFailure> {
    return coverage
      .covered(projectId)
      .pipe(
        Effect.catchTag('ProjectRootsUnavailable', (refusal) =>
          refusal.reason === 'unestablished' || refusal.reason === 'moved' ? coverage.cover(projectId) : Effect.fail(refusal),
        ),
      );
  }

  const containing = Effect.fn('CheckoutPlaces.containing')(function* (
    covered: readonly ProjectRoot[],
    named: string,
  ): Effect.fn.Return<ProjectRoot | null, GateRefusal<PlaceRefusal>> {
    const byId = covered.find((row) => row.rootId === named);
    if (byId !== undefined) return byId;
    if (!paths.isAbsolute(named)) return null;
    const here = yield* files
      .realPath(named)
      .pipe(
        Effect.catchTag('PlatformError', (failure) =>
          failure.reason._tag === 'NotFound'
            ? Effect.succeed(named)
            : new GateRefusal('root-inconclusive', failure.message, [
                'read the filesystem refusal and retry once the path can be resolved',
              ]),
        ),
      );
    const inside = covered.filter((row) => withinCheckout(row.path, here));
    return inside.reduce<ProjectRoot | null>(
      (deepest, row) => (deepest === null || row.path.length > deepest.path.length ? row : deepest),
      null,
    );
  });

  return { ...reader, rootOf, placeOf } satisfies GitCheckoutReads;
});
