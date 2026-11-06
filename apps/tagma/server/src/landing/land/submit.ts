import { randomUUID } from 'node:crypto';
import { Cause, Effect, type Context, type FileSystem } from 'effect';
import type { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import type { Git } from '@runlith/git/Git';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { Retirement } from '../../change-record/contract/service/retirement.js';
import { Holdings } from '../../change-record/contract/service/holdings.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { LandingOrigin, PreparedChanges, TeamMember } from '../../change-record/contract/service/prepared.js';
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
import { formingOver } from './formed.js';
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
import { landedBy, witnessSubmission } from '../store/submissions.js';
import { receipt as publicationReceipt } from '../../platform/git/publish.js';
import { GraphSyncing } from '../contract/service/graphSyncing.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

type Landing = CommitTrees | ChangeRecord | FileSystem.FileSystem | LineWrites | Retirement | Holdings | CommitLandings | GraphSyncing;

type Submission = { readonly receipt: SubmitReceipt; readonly team: readonly TeamMember[]; readonly carried: ReadonlySet<string> };

const unreadCommits = (receipt: Extract<SubmitReceipt, { status: 'nothing' }>, failure: { readonly message: string }): SubmitReceipt => ({
  ...receipt,
  unrecorded: [
    ...(receipt.unrecorded ?? []),
    { step: 'receipt', reason: `which commits already carried this session's files could not be read: ${failure.message}` },
  ],
});

type LandingPhase = {
  step: string;
  witnessed: { readonly commit: string; readonly ref: string; readonly job: string; readonly receipt: SubmitReceipt } | null;
  published: { readonly commit: string; readonly subject: string } | null;
};

const interrupted = Effect.fn('submitWork.interrupted')(function* (phase: LandingPhase, git: Git['Service'], root: string) {
  const at = phase.witnessed;
  if (at === null)
    return yield* new GateRefusal(
      'landing-cut',
      `the landing in ${root} was interrupted at "${phase.step}", before anything was published, so nothing was committed`,
      ['read the branch before asking again: read_checkout, read_checkout_history'],
    );
  const unproven = (why: string) =>
    new GateRefusal(
      'root-unproven',
      `the landing in ${root} was interrupted at "${phase.step}" with ${at.commit.slice(0, 10)} ready for ${at.ref}, and ${why}`,
      ['read_checkout_history before submitting again'],
    );
  const reached = yield* Effect.mapError(publicationReceipt(git, root, at.ref, at.commit, at.job), (failure) =>
    unproven(`whether it was published could not be read: ${failure.message}`),
  );
  if (reached === 'uncertain') return yield* unproven('whether it was published could not be told');
  phase.published ??= { commit: at.commit, subject: at.receipt.status === 'landed' ? (at.receipt.subject ?? '') : '' };
  return at.receipt;
});

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
  const phase: LandingPhase = { step: 'placing the checkout', witnessed: null, published: null };
  const said = yield* CallStage;
  const landings = yield* CommitLandings;
  const landed = Effect.gen(function* (): Effect.fn.Return<SubmitReceipt, SubmitFailure, Landing> {
    const { projectId } = input;
    const placed = yield* Effect.mapError(
      (yield* ChangeRecord).checkout(projectId, root),
      (failure) =>
        new GateRefusal('root-unproven', `the checkout this commit lands in cannot be placed: ${failure.reason}`, [
          'submit again once the checkout reads',
        ]),
    );
    const retirement = yield* Retirement;
    const submitted = yield* retirement.lease(
      RootId.make(placed),
      submitHeld(git, hosted, root, store, units, origin, caller, input, checks, produce, placed, phase),
    );
    const { receipt, team, carried } = submitted;
    const place = { git, root, store, units, checkout: placed };
    if (receipt.status === 'nothing') {
      if (input.paths !== undefined || team.length === 0) return receipt;
      const found = yield* Effect.result(produce.carriedBy(place, team));
      const own = yield* Effect.result(
        landedBy(
          store.db,
          units,
          team.map((one) => one.threadId),
          root,
        ),
      );
      if (found._tag === 'Failure') return unreadCommits(receipt, found.failure);
      if (own._tag === 'Failure') return unreadCommits(receipt, own.failure);
      const commits = found.success.filter((commit) => !own.success.has(commit));
      return commits.length === 0 ? receipt : { ...receipt, commits };
    }
    if (receipt.status !== 'landed') return receipt;
    const standing = yield* Effect.result(produce.remaining(place, team));
    if (standing._tag === 'Failure')
      return {
        ...receipt,
        unrecorded: [
          ...(receipt.unrecorded ?? []),
          { step: 'receipt', reason: `which files of this session still differ from HEAD could not be read: ${standing.failure.message}` },
        ],
      };
    const kept = new Set((receipt.kept ?? []).map((one) => one.path));
    const left = standing.success
      .filter((path) => !kept.has(path))
      .sort()
      .map((path) => ({ path, reason: carried.has(path) || input.paths === undefined ? ('written' as const) : ('paths' as const) }));
    return { ...receipt, left: left.length === 0 ? undefined : left };
  });
  return yield* landed.pipe(
    Effect.provideService(CallStage, (detail: string) => {
      phase.step = detail;
      said(detail);
    }),
    Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? interrupted(phase, git, root) : Effect.failCause(cause))),
    Effect.onExit(() =>
      phase.published === null || origin.work === null
        ? Effect.void
        : landings.publish({ threadId: origin.work.threadId, projectId: origin.work.projectId, ...phase.published }),
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
  phase: LandingPhase,
): Effect.fn.Return<Submission, SubmitFailure, Landing> {
  const { projectId } = input;
  const message = messageOf(subjectFor(input.subject, input.tasks), input.body, input.tasks, input.coAuthored);
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
  const form = formingOver(changes, checkout, carrying);
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
          Effect.tap(
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
            () =>
              Effect.sync(() => {
                phase.witnessed = { commit, ref, job, receipt: submitted };
              }),
          ),
        intents,
        lanes,
        trees,
        retirement,
        carry,
        read,
        form,
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
        return { receipt: { status: 'refused', reason: `${saidByGit(failure)}${lost}`, ...hookFields(edits) }, ...UNSUBMITTED };
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
      return { receipt: { status: 'refused', reason: saidByGit(answer.failure) }, ...UNSUBMITTED };
    }
    return yield* answer.failure;
  }
  const { landed: done, emptied, unmatched, team } = answer.success;
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
      return unrecorded;
    }
    return yield* recorded('discharge', retirement.pass(checkoutId));
  });
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
    const reshape =
      settled === null
        ? { edits: NO_EDITS, unrecorded: [] }
        : settled._tag === 'Failure'
          ? { edits: NO_EDITS, unrecorded: [{ step: 'reshape' as const, reason: settled.failure.message }] }
          : {
              edits: settled.success,
              unrecorded: settled.success.unrecorded.map((path) => ({
                step: 'reshape' as const,
                reason: `${path} carries the commit steps' change, and the session's row of that write was not recorded`,
              })),
            };
    const unrecorded = [...formed, ...reshape.unrecorded, ...(yield* discharged(answer.success.paths))];
    return {
      receipt: {
        status: 'nothing',
        unmatched: unmatched.length === 0 ? undefined : [...unmatched],
        unrecorded: unrecorded.length === 0 ? undefined : unrecorded,
        ...hookFields(reshape.edits),
      },
      team,
      carried: NO_PATHS,
    };
  }
  const subject = done.hooked.message.split(/\r?\n/, 1)[0] ?? done.hooked.message;
  phase.published = { commit: done.commit, subject };
  (yield* CallStage)(`${done.commit.slice(0, 10)} landed; carrying the hooks' edits and releasing the landed lines`);
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
  const selected = done.built.plan.map((one) => one.path);
  const discharge = yield* discharged(selected);
  const swept = yield* recorded('discharge', changes.sweep(git, root, placed));
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
    ...discharge,
    ...swept,
  ];
  const empty = done.built.base === undefined ? yield* Effect.result(emptyTree(git, root)) : undefined;
  if (empty?._tag === 'Failure') {
    yield* Effect.logWarning('the empty tree could not be read, so the rules judge this commit without a base', {
      reason: empty.failure.message,
    });
  }
  const base = done.built.base ?? (empty?._tag === 'Success' ? empty.success : null);
  const graph = done.merged ? yield* (yield* GraphSyncing)(projectId, root) : undefined;
  yield* checks.after({
    kind: 'tree',
    projectId,
    root,
    commit: done.commit,
    paths: [...done.changed].sort(),
    caller,
    base: base ?? undefined,
  });
  return {
    receipt: {
      ...done.receipt,
      unsynced: done.unsynced.length === 0 ? undefined : done.unsynced,
      unrecorded: unrecorded.length === 0 ? undefined : unrecorded,
      graph,
      ...hookFields(edits),
    },
    team,
    carried: new Set(selected),
  };
});

const UNHELD: ReshapeHolder = { _tag: 'unheld' };

const NO_PATHS: ReadonlySet<string> = new Set();

const UNSUBMITTED = { team: [], carried: NO_PATHS } as const;

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
