import { randomUUID } from 'node:crypto';
import { Effect, FileSystem } from 'effect';
import type { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import { Git } from '@runlith/git/Git';
import type { PullMerge } from '@runlith/git/porcelain';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { admitted } from '../../platform/contract/service/routed.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { nativeThreadIdOf } from '../../platform/contract/wire/actor.js';
import { notAdmitted, OwnGitFailed } from '../../platform/git/ownGit.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { actChecks, RuleChecks } from '../../enforcement/contract/service/ruleChecks.js';
import type { Checked } from '../../enforcement/contract/wire/checks.js';
import { GIT_COMMIT } from '../../enforcement/contract/wire/landings.js';
import { terminalActorOfRef } from '../../executions/terminals/principals.js';
import { ChangeRecord, type ChangeCheckout } from '../../change-record/contract/service/record.js';
import type { ReshapeHolder } from '../../change-record/contract/wire/reshape.js';
import { Retirement } from '../../change-record/contract/service/retirement.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { CheckoutActor, CheckoutPlaces, CheckoutWrites, type CheckoutAt } from '../../workspace/contract/service/checkouts.js';
import { CallerWorkspace, WorkingOrigins } from '../../workspace/contract/service/places.js';
import { type CheckoutPlace, checkoutRefusal, placeOf, standing } from '../../workspace/operations/place.js';
import { CHECKOUT_COMMIT_OPERATIONS as ACTS } from '../contract/wire/checkoutCommits.js';
import { hookFields } from '../contract/wire/receipt.js';
import { CommitShape } from '../../change-record/contract/service/shape.js';
import { COMMITTING, HookRefused } from '../land/hooks.js';
import { cutRefusal } from '../land/commit.js';
import { formingOver } from '../land/formed.js';
import { commitIndex, type CommitRequest, type IndexCommitted, type IndexJudge } from '../land/indexCommit.js';
import { LandingLanes } from '../land/lanes.js';
import { mergePulled, type PullMerged } from '../land/pullMerge.js';
import {
  applyCarried,
  carriedOnRefusal,
  carryDelta,
  carryEdits,
  carryPosted,
  deltaOf,
  joined,
  NO_EDITS,
  postedUnread,
  readDelta,
} from '../land/reshaping.js';

type Acts = typeof ACTS;

const gitRefusal = (failure: OwnGitFailed): GateRefusal =>
  failure.admission !== undefined
    ? notAdmitted(failure.admission)
    : new GateRefusal(failure.ran ? 'git-refused' : 'git-unreadable', `${failure.op}: ${failure.message}`, [
        'read what git said above and clear it, then act again',
      ]);

type Owners =
  | CurrentProject
  | CallerWorkspace
  | CheckoutPlaces
  | CheckoutWrites
  | CheckoutActor
  | WorkingOrigins
  | CommitTrees
  | ChangeRecord
  | RuleChecks
  | Git
  | FileSystem.FileSystem
  | LineWrites
  | CommitShape
  | Retirement;

type Making =
  | { readonly _tag: 'index'; readonly ask: CommitRequest; readonly judging: boolean }
  | { readonly _tag: 'pull'; readonly head: string; readonly merge: PullMerge };

const UNHELD: ReshapeHolder = { _tag: 'unheld' };

const carriageOf = (done: IndexCommitted | PullMerged): IndexCommitted | null => ('leaving' in done ? done : null);

const committing = Effect.fn('checkout.commit')(function* (at: CheckoutAt, caller: Caller, making: Making) {
  const callerProject = (yield* yield* CurrentProject).project.id;
  const projectId = at.projectId;
  const git = yield* Git;
  const trees = yield* CommitTrees;
  const shape = yield* CommitShape;
  const lanes = yield* LandingLanes;
  const changes = yield* ChangeRecord;
  const rules = yield* RuleChecks;
  const retirement = yield* Retirement;
  const files = yield* FileSystem.FileSystem;
  const carrying = yield* Effect.context<FileSystem.FileSystem | LineWrites>();
  const resolved = (yield* CheckoutActor).resolve(caller.actor, callerProject);
  const actor = resolved === null ? undefined : terminalActorOfRef(resolved);
  const checks = actChecks(rules, 'commit_checkout');
  const thread = nativeThreadIdOf(caller.actor);
  const home = caller.actor.kind === 'thread' ? caller.actor.projectId : callerProject;
  const origins = yield* WorkingOrigins;
  const judging = making._tag === 'index' && making.judging;
  return yield* (yield* CheckoutWrites)
    .act(
      at,
      (root) =>
        Effect.gen(function* () {
          const proved = yield* origins.rootOf(root);
          const origin = thread === null ? null : yield* origins.of({ projectId: home, threadId: thread }, root);
          const checkout: ChangeCheckout = { git, root, projectId, origin: proved };
          const held: ReshapeHolder = origin === null ? UNHELD : { _tag: 'held', work: origin.work };
          const judge: IndexJudge = (built, base, paths, merged) =>
            checks.before({
              kind: 'tree',
              projectId,
              root,
              base,
              built,
              merged,
              paths,
              caller: actor,
              advisory: judging ? undefined : true,
            });
          const job = `checkout:${randomUUID()}`;
          const result = yield* Effect.result(
            making._tag === 'index'
              ? commitIndex(git, trees, lanes, shape, {
                  ...making.ask,
                  projectId,
                  root,
                  judge,
                  form: formingOver(changes, checkout, carrying),
                  job,
                  act: resolved ?? { kind: 'operator' },
                  landing: (commit, tree) =>
                    Effect.mapError(
                      retirement.landing({ checkout: at.rootId, commit, tree }),
                      (failure) =>
                        new GateRefusal('record-unread', `the tree this commit was built from could not be recorded: ${failure.message}`, [
                          'commit again once the change record writes',
                        ]),
                    ),
                  read: (delta) =>
                    Effect.mapError(
                      Effect.provideService(readDelta(changes, checkout, delta), FileSystem.FileSystem, files),
                      (failure) =>
                        new GateRefusal(
                          'reshape-unreadable',
                          `what the steps or hooks changed could not be read, so nothing was committed: ${failure.message}`,
                          ['commit again once the change record and the files read'],
                        ),
                    ),
                })
              : mergePulled(git, trees, lanes, { root, head: making.head, merge: making.merge, job }),
          );
          if (result._tag === 'Failure') {
            const failure = result.failure;
            if (!(failure instanceof HookRefused)) return yield* Effect.fail(failure);
            const carried = yield* carriedOnRefusal(changes, checkout, failure, held);
            const said = `${carried.said}${carried.lost}`;
            const cause = failure.failure._tag === 'HoldCut' ? cutRefusal(root, failure.failure) : failure.failure;
            if (cause instanceof GateRefusal)
              return yield* new GateRefusal(cause.code, `${cause.reason}${said}`, cause.unblock, cause.inputFile, cause.words);
            if (cause instanceof OwnGitFailed)
              return yield* Effect.fail(
                cause.admission === undefined
                  ? new OwnGitFailed({ op: cause.op, message: `${cause.message}${said}`, ran: cause.ran })
                  : cause,
              );
            return yield* new GateRefusal('record-unread', `${cause.message}${said}`, ['read the checkout and commit again']);
          }
          const done = result.success;
          const read = carriageOf(done);
          const staged = yield* Effect.result(
            read === null
              ? Effect.flatMap(deltaOf(git, root, done.staged, done.committing.tree), (delta) =>
                  carryDelta(changes, checkout, delta, UNHELD, { commit: done.commit, source: 'steps' }),
                )
              : applyCarried(changes, checkout, read.staging, UNHELD, { commit: done.commit, source: 'steps' }),
          );
          const left = yield* Effect.result(
            read === null
              ? carryEdits(changes, checkout, done.committing.tree, done.committing.left, held)
              : applyCarried(changes, checkout, read.leaving, held),
          );
          const hook = read === null ? null : read.posted;
          const posted = hook === null ? null : yield* Effect.result(carryPosted(changes, checkout, hook, done.commit));
          if (hook !== null && hook.unread !== null) yield* Effect.logWarning(postedUnread(hook.unread), { root });
          const retired = yield* Effect.result(retirement.pass(at.rootId));
          for (const outcome of [staged, left, ...(posted === null ? [] : [posted]), retired]) {
            if (outcome._tag === 'Failure')
              yield* Effect.logWarning(
                "a commit landed and its hooks' edits could not be carried into the working files or the change record",
                { root, reason: outcome.failure.message },
              );
          }
          const edits = [left, ...(posted === null ? [] : [posted])].reduce(
            (all, carried) => joined(all, carried._tag === 'Success' ? carried.success : NO_EDITS),
            staged._tag === 'Success' ? staged.success : NO_EDITS,
          );
          if (making._tag === 'index') {
            yield* checks.after({
              kind: 'tree',
              projectId,
              root,
              commit: done.commit,
              paths: [...done.paths].sort(),
              caller: actor,
              carried: judging
                ? undefined
                : read?.judgement?.watched.flatMap((one) => ('fingerprint' in one ? [{ ...one, holders: ['operator'] }] : [])),
            });
          } else {
            yield* rules.landed(GIT_COMMIT, {
              kind: 'commit',
              projectId,
              root,
              commit: done.commit,
              caller: actor,
            });
          }
          return {
            commit: done.commit,
            paths: done.paths,
            unsynced: done.unsynced,
            edits,
            formatSkipped: 'formatSkipped' in done && done.formatSkipped,
            judgement: read === null ? null : read.judgement,
          };
        }).pipe(Effect.mapError((failure) => (failure instanceof OwnGitFailed ? gitRefusal(failure) : failure))),
      (done) => done.paths,
    )
    .pipe(Effect.mapError((failure) => (failure instanceof GateRefusal ? failure : checkoutRefusal(failure))));
});

const unsyncedOf = (unsynced: readonly string[]) => (unsynced.length === 0 ? {} : { unsynced });

const judgedFields = (judgement: Checked | null) => ({
  watched: judgement === null || judgement.watched.length === 0 ? undefined : judgement.watched,
  bodies: judgement?.bodies === undefined || Object.keys(judgement.bodies).length === 0 ? undefined : judgement.bodies,
  unjudged: judgement === null || judgement.unjudged.length === 0 ? undefined : judgement.unjudged,
});

export const CHECKOUT_COMMIT_PAIRS = {
  commit_checkout: pair(
    ACTS.commit_checkout,
    body<Acts['commit_checkout'], CheckoutPlace, Owners>(ACTS.commit_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (input, place: CheckoutPlace, caller) {
        const at = yield* standing(place);
        const ask = { message: input.message, amend: input.amend === true, kind: COMMITTING, withoutFormat: input.withoutFormat === true };
        const made = yield* admitted(ACTS.commit_checkout)(
          committing(at, caller, { _tag: 'index', ask, judging: caller.actor.kind !== 'operator' }),
        );
        return {
          status: 'ok' as const,
          paths: [],
          writing: made.writing,
          commit: made.answer.commit,
          ahead: made.ahead,
          ...unsyncedOf(made.answer.unsynced),
          formatSkipped: made.answer.formatSkipped ? true : undefined,
          ...judgedFields(made.answer.judgement),
          ...hookFields(made.answer.edits),
        };
      }),
    }),
  ),

  pull_checkout: pair(
    ACTS.pull_checkout,
    body<Acts['pull_checkout'], CheckoutPlace, Owners>(ACTS.pull_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (_input, place: CheckoutPlace, caller) {
        const at = yield* standing(place);
        const pulled = yield* admitted(ACTS.pull_checkout)(Effect.mapError((yield* CheckoutWrites).pull(at), checkoutRefusal));
        if (pulled.merge === null || pulled.head === null) {
          return {
            status: 'ok' as const,
            paths: pulled.paths,
            writing: pulled.writing,
            head: pulled.head,
            moved: pulled.moved,
            merge: null,
            conflicted: pulled.conflicted,
          };
        }
        const made = yield* admitted(ACTS.pull_checkout)(committing(at, caller, { _tag: 'pull', head: pulled.head, merge: pulled.merge }));
        return {
          status: 'ok' as const,
          paths: [...made.answer.paths],
          writing: [...pulled.writing, ...made.writing.filter((one) => !pulled.writing.includes(one))],
          head: made.answer.commit,
          moved: true,
          merge: made.answer.commit,
          conflicted: false,
          ...unsyncedOf(made.answer.unsynced),
          ...hookFields(made.answer.edits),
        };
      }),
    }),
  ),
};
