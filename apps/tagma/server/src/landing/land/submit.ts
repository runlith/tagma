import { randomUUID } from 'node:crypto';
import { Effect, type Context, type FileSystem } from 'effect';
import type { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import type { Git } from '@runlith/git/Git';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { Retirement } from '../../change-record/contract/service/retirement.js';
import { Holdings, type Judged } from '../../change-record/contract/service/holdings.js';
import { pathsOfThread } from '../../change-record/record/reads.js';
import { carriersOf } from '../../change-record/prepared/carriers.js';
import { owes } from '../../change-record/holdings/totals.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { LandingOrigin, PreparedChanges } from '../../change-record/contract/service/prepared.js';
import { emptyTree, saidByGit } from '../../change-record/prepared/subject.js';
import { notAdmitted, OwnGitFailed } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CallStage } from '../../platform/contract/service/stage.js';
import { hookFields, type SubmitReceipt, type Unrecorded } from '../contract/wire/receipt.js';
import { CommitLandings } from '../contract/service/commitLandings.js';
import type { SubmitFailure, SubmitRequest } from '../contract/service/landings.js';
import { LandingLanes } from './lanes.js';
import { messageOf, subjectFor } from './message.js';
import { commitOwn, type CommitCtx, cutRefusal } from './commit.js';
import { HookRefused } from './hooks.js';
import {
  applyCarried,
  carriedOnRefusal,
  carriedSafely,
  carryDelta,
  carryPosted,
  postedUnread,
  type Delta,
  joined,
  NO_EDITS,
  readDelta,
  steppedDelta,
} from './reshaping.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { type ChangeCheckout, ChangeRecord } from '../../change-record/contract/service/record.js';
import type { Reshaped, ReshapeHolder } from '../../change-record/contract/wire/reshape.js';
import { landingIntents } from './intents.js';
import { intentLifecycle } from '../store/intentLifecycle.js';
import { SignedCall } from '../../platform/contract/service/writers.js';
import { witnessSubmission } from '../store/submissions.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

type Landing = CommitTrees | ChangeRecord | FileSystem.FileSystem | LineWrites | Retirement | Holdings | CommitLandings;

export const submitWork = Effect.fn('submitWork')(function* (
  git: Git['Service'],
  hosted: Git['Service'],
  root: string,
  store: StoreShape,
  units: MachineUnits['Service'],
  origin: LandingOrigin,
  caller: TerminalActor | undefined,
  input: SubmitRequest,
  checks: ActChecks,
  produce: Context.Service.Shape<typeof PreparedChanges>,
): Effect.fn.Return<SubmitReceipt, SubmitFailure, Landing> {
  const { projectId } = input;
  const placed = yield* Effect.mapError(
    (yield* ChangeRecord).checkout(projectId, root),
    (failure) =>
      new GateRefusal('root-unproven', `the checkout this commit lands in cannot be placed: ${failure.reason}`, [
        'submit again once the checkout reads',
      ]),
  );
  const carriers = carriersOf(origin, input);
  const leased = yield* Effect.forEach(carriers, ({ projectId, threadId }) => pathsOfThread(units, store, projectId, threadId, placed));
  const unplaced = (failure: { readonly message: string }) =>
    Effect.fail(
      new GateRefusal('root-unproven', `the checkout this commit lands in cannot be judged: ${failure.message}`, [
        'submit again once the checkout reads',
      ]),
    );
  const holdings = yield* Holdings;
  const retirement = yield* Retirement;
  const paths = [...new Set(leased.flat().map((one) => one.path))];
  const said = yield* CallStage;
  said(`waiting for a fresh judgement of the ${paths.length} paths this session holds`);
  const landings = yield* CommitLandings;
  let published: { readonly commit: string; readonly subject: string } | null = null;
  const landed = (commit: string, subject: string) => {
    published = { commit, subject };
  };
  return yield* Effect.acquireUseRelease(
    produce.lease(input),
    () =>
      retirement.lease(
        RootId.make(placed),
        holdings
          .lease(
            RootId.make(placed),
            paths,
            submitHeld(git, hosted, root, store, units, origin, caller, input, checks, produce, placed, paths, landed),
          )
          .pipe(
            Effect.catchTags({
              RootMissing: unplaced,
              RootUnavailable: unplaced,
              RootInvalid: unplaced,
              RootConflict: unplaced,
              RootRefused: unplaced,
            }),
          ),
      ),
    (release) => Effect.sync(release),
  ).pipe(
    Effect.onExit(() =>
      published === null || origin.work === null
        ? Effect.void
        : landings.publish({ threadId: origin.work.threadId, projectId: origin.work.projectId, ...published }),
    ),
  );
});

const submitHeld = Effect.fn('submitWork.held')(function* (
  git: Git['Service'],
  hosted: Git['Service'],
  root: string,
  store: StoreShape,
  units: MachineUnits['Service'],
  origin: LandingOrigin,
  caller: TerminalActor | undefined,
  input: SubmitRequest,
  checks: ActChecks,
  produce: Context.Service.Shape<typeof PreparedChanges>,
  placed: string,
  paths: readonly string[],
  landed: (commit: string, subject: string) => void,
): Effect.fn.Return<SubmitReceipt, SubmitFailure, Landing> {
  const { projectId } = input;
  const message = messageOf(
    subjectFor(input.subject, input.tasks),
    input.body,
    [...input.tasks, ...input.taking.flatMap((session) => session.tasks)],
    input.coAuthored,
  );
  const changes = yield* ChangeRecord;
  const holdings = yield* Holdings;
  const retirement = yield* Retirement;
  const checkoutId = RootId.make(placed);
  const intents = landingIntents(intentLifecycle(store.db, units));
  const lanes = yield* LandingLanes;
  const trees = yield* CommitTrees;
  const checkout: ChangeCheckout = { git, root, projectId, origin };
  const held: ReshapeHolder = origin.work === null ? UNHELD : { _tag: 'held', work: origin.work };
  const carrying = yield* Effect.context<FileSystem.FileSystem | LineWrites>();
  const carry = (built: string, left: string, stepped: readonly Reshaped[]) =>
    Effect.provide(carriedSafely(changes, checkout, built, left, held, stepped), carrying);
  const read = (delta: Delta) =>
    Effect.provide(
      Effect.mapError(
        readDelta(changes, checkout, delta),
        (failure) =>
          new GateRefusal(
            'reshape-unreadable',
            `what the steps or hooks changed could not be read, so nothing was committed: ${failure.message}`,
            ['commit again once the change record and the files read'],
          ),
      ),
      carrying,
    );
  const callId = yield* SignedCall;
  const work = origin.work;
  const job = `landing:${randomUUID()}`;
  const answer = yield* Effect.result(
    commitOwn(
      checks,
      {
        git,
        hosted,
        root,
        store,
        units,
        origin,
        input,
        message,
        caller,
        checkout: placed,
        job,
        witness: (commit, ref, submitted) =>
          callId === null || work === null
            ? Effect.void
            : witnessSubmission(store.db, units, {
                threadId: work.threadId,
                projectId: work.projectId,
                callId,
                checkout: root,
                ref,
                job,
                commit,
                submitted,
                complete: false,
              }),
        intents,
        lanes,
        trees,
        retirement,
        carry,
        read,
      } satisfies CommitCtx,
      produce,
    ),
  );
  if (answer._tag === 'Failure') {
    if (answer.failure instanceof HookRefused) {
      const stopped = answer.failure;
      const failure = stopped.failure;
      const { edits, said: carried, lost } = yield* carriedOnRefusal(changes, checkout, stopped, held);
      if (failure instanceof OwnGitFailed) {
        if (failure.admission !== undefined) return yield* notAdmitted(failure.admission);
        return { status: 'refused', reason: `${saidByGit(failure)}${lost}`, ...hookFields(edits) };
      }
      const refusal = failure._tag === 'HoldCut' ? cutRefusal(root, failure) : failure;
      if (refusal instanceof GateRefusal)
        return yield* new GateRefusal(
          refusal.code as Refused['code'],
          `${refusal.reason}${carried}${lost}`,
          refusal.unblock,
          refusal.inputFile,
          refusal.words,
        );
      return yield* refusal;
    }
    if (answer.failure instanceof OwnGitFailed) {
      if (answer.failure.admission !== undefined) return yield* notAdmitted(answer.failure.admission);
      return { status: 'refused', reason: saidByGit(answer.failure) };
    }
    return yield* answer.failure;
  }
  const { landed: done, emptied, unmatched, unattributed } = answer.success;
  const discharged = Effect.fnUntraced(function* (candidates: readonly string[]) {
    const judged = yield* Effect.result(holdings.judged(checkoutId, candidates));
    if (judged._tag === 'Failure') {
      yield* Effect.logWarning('the holdings could not be judged', judged.failure);
      const unrecorded = yield* recorded(
        'discharge',
        Effect.fail({
          message: `the holdings could not be judged, so no row was discharged and what this session still holds is unknown: ${judged.failure.message}`,
        }),
      );
      return { judged: null, ended: false, unrecorded };
    }
    let ended = false;
    const unrecorded = yield* recorded(
      'discharge',
      Effect.tap(retirement.pass(checkoutId), (gone) =>
        Effect.sync(() => {
          ended = gone.committed.length + gone.withdrawn.length > 0;
        }),
      ),
    );
    return { judged: judged.success, ended, unrecorded };
  });
  const retired = () => Effect.map(discharged(paths), (done) => done.unrecorded);
  if (done === null) {
    const settled =
      emptied === null
        ? null
        : yield* Effect.result(
            carryDelta(
              changes,
              checkout,
              steppedDelta(emptied.reshaped),
              UNHELD,
              emptied.base === null ? undefined : { commit: emptied.base, source: 'steps' },
            ),
          );
    const formed = emptied === null ? [] : yield* recorded('stamp', retirement.formed(checkoutId, emptied.ids));
    const unrecorded = [
      ...formed,
      ...(settled?._tag === 'Failure' ? [{ step: 'reshape' as const, reason: settled.failure.message }] : []),
      ...(settled?._tag === 'Success'
        ? settled.success.unrecorded.map((path) => ({
            step: 'reshape' as const,
            reason: `${path} carries the commit steps' change, and the session's row of that write was not recorded`,
          }))
        : []),
      ...(yield* retired()),
    ];
    return {
      status: 'nothing',
      unattributed: unattributed.length === 0 ? undefined : [...unattributed],
      unmatched: unmatched.length === 0 ? undefined : [...unmatched],
      unrecorded: unrecorded.length === 0 ? undefined : unrecorded,
      ...hookFields(settled?._tag === 'Success' ? settled.success : NO_EDITS),
    };
  }
  const subject = done.hooked.message.split(/\r?\n/, 1)[0] ?? done.hooked.message;
  landed(done.commit, subject);
  (yield* CallStage)(`${done.commit.slice(0, 10)} landed; carrying the hooks' edits and releasing the landed lines`);
  const carriers = carriersOf(origin, input);
  const owing = { commit: done.commit, source: 'steps' } as const;
  const stepped = yield* Effect.result(applyCarried(changes, checkout, done.carriage.stepped, UNHELD, owing));
  const staged = yield* Effect.result(applyCarried(changes, checkout, done.carriage.staged, UNHELD, owing));
  const remained = yield* Effect.result(applyCarried(changes, checkout, done.carriage.left, held));
  const posted = done.posted === null ? null : yield* Effect.result(carryPosted(changes, checkout, done.posted, done.commit));
  const edits = [stepped, staged, remained, ...(posted === null ? [] : [posted])].reduce(
    (all, carried) => joined(all, carried._tag === 'Success' ? carried.success : NO_EDITS),
    done.earlier.edits,
  );
  const receipt =
    done.intent === null || done.conclusion !== null || done.unsynced.length > 0
      ? []
      : yield* recorded('receipt', intents.land(done.intent, done.commit));
  const [standing, unreadable] = yield* Effect.partition(carriers, ({ projectId, threadId }) =>
    pathsOfThread(units, store, projectId, threadId, placed),
  );
  const candidates = [
    ...new Set([...paths, ...done.built.plan.map((one) => one.path), ...standing.flatMap((rows) => rows.map((one) => one.path))]),
  ];
  const discharge = yield* discharged(candidates);
  const swept = yield* recorded('discharge', changes.sweep(git, root, placed));
  const owedIn = (judged: ReadonlyMap<string, Judged>) =>
    [...judged.values()]
      .filter((one) => carriers.some((carrier) => owes(one.holding, carrier.threadId)))
      .map((one) => one.holding.path)
      .sort();
  const before = discharge.judged === null ? null : owedIn(discharge.judged);
  const after =
    before !== null && before.length > 0 && discharge.ended ? yield* Effect.result(holdings.judged(checkoutId, candidates)) : null;
  const judged = after?._tag === 'Success' ? after.success : discharge.judged;
  const unanswered = judged === null ? [] : candidates.filter((path) => !judged.has(path)).sort();
  const unread = [
    ...unreadable.map((failure) => ({
      step: 'receipt' as const,
      reason: `what this session still holds could not be read: ${failure.message}`,
    })),
    ...(after?._tag === 'Failure'
      ? [
          {
            step: 'receipt' as const,
            reason: `left and unattributed use the judgement taken before the record was discharged, because judging again failed: ${after.failure.message}`,
          },
        ]
      : []),
    ...(unanswered.length === 0
      ? []
      : [{ step: 'receipt' as const, reason: `whether this session still holds lines in ${unanswered.join(', ')} could not be judged` }]),
  ];
  const left = judged === null || unreadable.length > 0 ? null : owedIn(judged);
  const unowned = [
    ...new Set([
      ...unattributed,
      ...done.built.plan.flatMap(({ path }) => {
        const one = judged?.get(path);
        return one?.verdict.verdict === 'proven' && one.verdict.unheld ? [path] : [];
      }),
    ]),
  ].sort();
  const unrecorded = [
    ...(done.conclusion === null ? [] : [{ step: 'receipt' as const, reason: done.conclusion }]),
    ...receipt,
    ...[stepped, staged, remained, ...(posted === null ? [] : [posted])].flatMap((carried) =>
      carried._tag === 'Failure' ? [{ step: 'reshape' as const, reason: carried.failure.message }] : [],
    ),
    ...(done.posted === null || done.posted.unread === null
      ? []
      : [{ step: 'reshape' as const, reason: postedUnread(done.posted.unread) }]),
    ...(done.earlier.lost === '' ? [] : [{ step: 'reshape' as const, reason: done.earlier.lost.replace(/^; /, '') }]),
    ...edits.unrecorded.map((path) => ({
      step: 'reshape' as const,
      reason: `${path} carries the hooks' edits, and the session's row of that write was not recorded`,
    })),
    ...discharge.unrecorded,
    ...swept,
  ];
  const empty = done.built.base === undefined ? yield* Effect.result(emptyTree(git, root)) : undefined;
  if (empty?._tag === 'Failure') {
    yield* Effect.logWarning('the empty tree could not be read, so the rules judge this commit without a base', {
      reason: empty.failure.message,
    });
  }
  const base = done.built.base ?? (empty?._tag === 'Success' ? empty.success : null);
  yield* checks.after({
    kind: 'tree',
    projectId,
    root,
    commit: done.commit,
    paths: [...done.changed].sort(),
    carried: done.judged.carriedViolations,
    caller,
    base: base ?? undefined,
  });
  return {
    ...done.receipt,
    left: left === null || left.length === 0 ? undefined : left,
    unattributed: unowned.length === 0 ? undefined : unowned,
    unsynced: done.unsynced.length === 0 ? undefined : done.unsynced,
    unrecorded: unrecorded.length + unread.length === 0 ? undefined : [...unrecorded, ...unread],
    ...hookFields(edits),
  };
});

const UNHELD: ReshapeHolder = { _tag: 'unheld' };

type Refused = Extract<SubmitFailure, GateRefusal>;

const recorded = <E extends { readonly message: string }, R>(
  step: Unrecorded['step'],
  work: Effect.Effect<unknown, E, R>,
): Effect.Effect<readonly Unrecorded[], never, R> =>
  Effect.matchEffect(work, {
    onSuccess: () => Effect.succeed([]),
    onFailure: (failure) =>
      Effect.as(Effect.logWarning('a landed commit left the change record behind', { step, reason: failure.message }), [
        { step, reason: failure.message },
      ]),
  });
