import { stepHunks, through } from '../../change-record/prepared/stepLines.js';
import { Clock, Effect, type Context } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import type { Position } from '@runlith/held/Lane';
import { runGit, type OwnGitFailed } from '../../platform/git/ownGit.js';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import { CallStage } from '../../platform/contract/service/stage.js';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { actorRefOfTerminal } from '../../executions/terminals/principals.js';
import type { ShapeRefusal } from '../../change-record/contract/wire/shape.js';
import type { Reshaped } from '../../change-record/contract/wire/reshape.js';
import type { JudgeRefusalCode } from '../../enforcement/contract/wire/enforcement.js';
import { type Checked, passed as judgedPassed } from '../../enforcement/contract/wire/checks.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import type {
  LandingOrigin,
  PreparedChanges,
  PreparedBuilt,
  PreparedEmptied,
  PreparedLanding,
  PreparedSubject,
} from '../../change-record/contract/service/prepared.js';
import type { Forming } from './formed.js';
import { headOf, readMerge } from '../../change-record/prepared/subject.js';
import { indexWrites } from '../../platform/git/index.js';
import type { SubmitRequest } from '../contract/service/landings.js';
import type { SubmitReceipt } from '../contract/wire/receipt.js';
import type { CheckoutLanes } from './lanes.js';
import { COMMITTING, commitHooks, type Committing, formedRefusal, HookRefused, landedHook, type Posted, withSteps } from './hooks.js';
import { advanced, concluded, makeCommit } from './publish.js';
import { both, type Carried, deltaOf, type Delta, NOTHING_CARRIED, type RefusedEdits, steppedDelta, unreadIn } from './reshaping.js';
import type { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { Retirement } from '../../change-record/contract/service/retirement.js';
import { knownEntries, syncHeldIndex, syncIndex } from './indexSync.js';
import type { LandingIntents } from './intents.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

const ATTEMPTS = 3;

type Lander = TerminalActor | undefined;

export type Carriage = { readonly stepped: Carried; readonly staged: Carried; readonly left: Carried };

export type Landed = {
  readonly carriage: Carriage;
  readonly commit: string;
  readonly intent: string | null;
  readonly built: PreparedBuilt;
  readonly judged: Checked;
  readonly changed: readonly string[];
  readonly unsynced: readonly string[];
  readonly hooked: Committing;
  readonly posted: Posted | null;
  readonly earlier: RefusedEdits;
  readonly conclusion: string | null;
  readonly receipt: Extract<SubmitReceipt, { readonly status: 'landed' }>;
};

export type CommitCtx = {
  readonly git: Git['Service'];
  readonly hosted: Git['Service'];
  readonly root: string;
  readonly store: StoreShape;
  readonly units: MachineUnits['Service'];
  readonly origin: LandingOrigin;
  readonly checkout: string;
  readonly input: SubmitRequest;
  readonly message: string;
  readonly caller: Lander;
  readonly job: string;
  readonly intents: LandingIntents;
  readonly lanes: CheckoutLanes;
  readonly trees: CommitTrees['Service'];
  readonly retirement: Retirement['Service'];
  readonly carry: (built: string, left: string, stepped: readonly Reshaped[]) => Effect.Effect<RefusedEdits>;
  readonly read: (delta: Delta) => Effect.Effect<Carried, GateRefusal<'reshape-unreadable'>>;
  readonly form: Forming;
  readonly witness: (commit: string, ref: string, submitted: SubmitReceipt) => Effect.Effect<void, StoreFailure>;
};

type Selection = {
  readonly unmatched: readonly string[];
  readonly paths: readonly string[];
  readonly unattributed: readonly string[];
};

type Published =
  | { readonly _tag: 'moved' }
  | { readonly _tag: 'published'; readonly commit: string; readonly unsynced: readonly string[]; readonly conclusion: string | null };

type LandingRefusal = GateRefusal<
  | 'no-record'
  | 'no-branch'
  | 'git-unavailable'
  | 'git-not-admitted'
  | 'tree-mid-merge'
  | 'walk-cut'
  | 'lines-held'
  | 'landing-busy'
  | 'landing-cut'
  | 'commit-unsigned'
  | 'reshape-unreadable'
  | ShapeRefusal
  | JudgeRefusalCode
>;

const busy = (root: string, why: string): GateRefusal<'landing-busy'> =>
  new GateRefusal('landing-busy', `${why} in ${root}, so nothing was committed`, ['ask again once the checkout has settled']);

const passed = (judging: Effect.Effect<Checked>): Effect.Effect<Checked, LandingRefusal> => Effect.flatMap(judging, judgedPassed);

const formedFor = (
  form: Forming,
  subject: PreparedSubject<Lander>,
  reshaped: readonly Reshaped[],
  judging: Effect.Effect<Checked>,
): Effect.Effect<Checked> => {
  const { holders } = subject;
  if (reshaped.length === 0) return judging;
  const forming = Effect.acquireUseRelease(
    form(reshaped),
    () => judging,
    (withdraw) => withdraw,
  );
  if (holders === undefined) return forming;
  return Effect.flatMap(Effect.result(holders(reshaped.map((one) => ({ file: one.path, line: 1 })))), (primed) => {
    if (primed._tag === 'Success') return forming;
    return Effect.flatMap(
      Effect.logWarning('the form the commit steps gave the working files was not laid before the rules judged them', {
        reason: primed.failure.message,
      }),
      () => judging,
    );
  });
};

export const cutRefusal = (root: string, failure: HoldCut): GateRefusal<'landing-cut'> =>
  new GateRefusal('landing-cut', `the ${failure.resource} step in ${root} ran past its ceiling and was cut: ${failure.leaves}`, [
    'read the branch before asking again: read_checkout, read_checkout_history',
  ]);

export const laneFailed = (
  root: string,
  failure: HoldStalled | HoldCut | ReentrantCall,
): Effect.Effect<never, GateRefusal<'landing-busy' | 'landing-cut'>> => {
  if (failure._tag === 'ReentrantCall') return Effect.die(failure);
  if (failure._tag === 'HoldStalled')
    return Effect.fail(
      busy(
        root,
        `the ${failure.resource} lane stayed held for the ${Math.round(failure.waitedMs / 1000)} s this landing could wait`,
      ) as GateRefusal<'landing-busy'>,
    );
  return Effect.fail(cutRefusal(root, failure));
};

export const withEarlier =
  (earlier: RefusedEdits | null) =>
  <E extends OwnGitFailed | GateRefusal | StoreFailure | HookRefused>(failure: E): E | HookRefused => {
    if (earlier === null) return failure;
    if (failure instanceof HookRefused) {
      return new HookRefused({
        failure: failure.failure,
        built: failure.built,
        left: failure.left,
        unread: failure.unread,
        earlier: both(earlier, failure.earlier ?? NOTHING_CARRIED),
        stepped: failure.stepped,
      });
    }
    return new HookRefused({ failure, built: '', left: '', unread: null, earlier, stepped: [] });
  };

const publish = (
  git: Git['Service'],
  hosted: Git['Service'],
  root: string,
  prepared: PreparedLanding<Lander>,
  commit: string,
  changed: readonly string[],
  job: string,
  bases: readonly (string | null)[],
  tree: string,
): Effect.Effect<Published, OwnGitFailed | LandingRefusal> => {
  const { built, merge, beside, index } = prepared;
  const { places, ref } = prepared;
  const landing = Effect.gen(function* () {
    if (merge !== undefined) {
      const now = yield* readMerge(git, root, places);
      if (now === undefined || now.tree !== merge.tree || now.parents.join('\n') !== merge.parents.join('\n'))
        return yield* busy(root, 'the resolved merge changed while its commit was made');
    }
    const sent = yield* advanced(
      git,
      hosted,
      { root, places, ref, base: built.base, job, concluding: merge === undefined ? undefined : 'merge', beside },
      commit,
    );
    if (sent._tag === 'moved') return sent;
    const known = knownEntries(built.entries, tree, sent.commit);
    const unsynced =
      merge === undefined
        ? yield* syncIndex(git, root, places.index, bases, sent.commit, changed, built.hashes, index, known)
        : yield* syncHeldIndex(git, root, [...bases, merge.tree], sent.commit, changed, built.hashes, index, places.index, known);
    const conclusion = merge === undefined ? null : yield* concluded(hosted, root, 'merge');
    return { _tag: 'published', commit: sent.commit, unsynced, conclusion } as const;
  });
  return merge === undefined
    ? landing
    : indexWrites.hold(places.index, landing).pipe(
        Effect.catchTags({
          HoldStalled: (failure) => laneFailed(root, failure),
          HoldCut: (failure) => laneFailed(root, failure),
        }),
      );
};

export const commitOwn = Effect.fn('submitWork.commit')(function* (
  checks: ActChecks,
  ctx: CommitCtx,
  produce: Context.Service.Shape<typeof PreparedChanges>,
): Effect.fn.Return<
  {
    readonly landed: Landed | null;
    readonly emptied: PreparedEmptied | null;
    readonly unmatched: readonly string[];
    readonly paths: readonly string[];
    readonly unattributed: readonly string[];
  },
  LandingRefusal | OwnGitFailed | StoreFailure | HookRefused
> {
  const { git, hosted, root, store, units, origin, checkout, input, message, caller, job, intents, lanes, trees, retirement, carry } = ctx;
  const bases: (string | null)[] = [];
  const held: PreparedLanding<Lander>[] = [];
  const deadline = (yield* Clock.currentTimeMillis) + CEILINGS.callCap;
  let place: Position | undefined;
  let earlier: RefusedEdits | null = null;
  const said = yield* CallStage;
  const stage = (detail: string) => Effect.sync(() => said(detail));
  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      const unfinished = yield* lanes.commits.enter(root, intents.resume(git, hosted, root)).pipe(
        Effect.catchTags({
          HoldStalled: (failure) => laneFailed(root, failure),
          HoldCut: (failure) => laneFailed(root, failure),
          ReentrantCall: (failure) => laneFailed(root, failure),
        }),
      );
      if (unfinished.length > 0) return yield* busy(root, unfinished.join('; '));
      let prepares = 0;
      let rebased: PreparedLanding<Lander> | null = null;
      let selection: Selection = { unmatched: [], paths: [], unattributed: [] };
      const onto = (prepared: PreparedLanding<Lander>, head: string | null) =>
        head === null ? Effect.succeed(null) : produce.rebase(git, root, prepared, head);
      for (let attempt = 1; ; attempt += 1) {
        if ((rebased === null && prepares >= ATTEMPTS) || (yield* Clock.currentTimeMillis) >= deadline) {
          return yield* busy(root, `the branch moved under each of ${attempt - 1} attempts`);
        }
        let prepared: PreparedLanding<Lander>;
        if (rebased === null) {
          prepares += 1;
          yield* stage(`attempt ${attempt}: selecting this session's lines and shaping them by the commit steps`);
          const outcome = yield* produce.prepare({
            projectId: input.projectId,
            git,
            root,
            store,
            units,
            origin,
            checkout,
            input,
            job,
            caller,
            act: caller === undefined ? { kind: 'operator' } : actorRefOfTerminal(caller),
          });
          selection = { unmatched: outcome.unmatched, paths: outcome.paths, unattributed: outcome.unattributed };
          if (outcome.prepared === null) {
            return { landed: null, emptied: outcome.emptied, ...selection };
          }
          held.push(outcome.prepared);
          prepared = outcome.prepared;
        } else {
          prepared = rebased;
          rebased = null;
        }
        const last = prepares >= ATTEMPTS;
        const ref = prepared.ref;
        const built = prepared.built;
        yield* stage(`attempt ${attempt}: judging the rules over ${built.changed.length} changed paths`);
        let judged = yield* Effect.mapError(
          passed(formedFor(ctx.form, prepared.subject, built.reshaped, checks.before(prepared.subject))),
          formedRefusal(built.tree, built.reshaped),
        );
        bases.push(built.base);
        const head = yield* headOf(git, root);
        if (head !== built.base) {
          rebased = yield* onto(prepared, head);
          if (rebased !== null || !last) continue;
        }
        yield* stage(`attempt ${attempt}: running the repository's commit hooks and making the commit`);
        const committing = yield* commitHooks(git, hosted, trees, root, prepared.places, built.base, built.tree, message).pipe(
          Effect.mapError(withSteps(built.reshaped)),
          Effect.catchTags({
            HoldStalled: (failure) => laneFailed(root, failure),
            HoldCut: (failure) => laneFailed(root, failure),
          }),
        );
        const hooked = <A, E extends OwnGitFailed | GateRefusal | StoreFailure>(
          work: Effect.Effect<A, E>,
        ): Effect.Effect<A, E | HookRefused> =>
          committing.left === built.tree && built.reshaped.length === 0
            ? work
            : Effect.mapError(
                work,
                (failure) =>
                  new HookRefused({
                    failure,
                    built: built.tree,
                    left: committing.left,
                    unread: null,
                    earlier: null,
                    stepped: built.reshaped,
                  }),
              );
        let changed: readonly string[] = built.changed;
        if (committing.tree !== built.tree) {
          const listed = yield* hooked(
            runGit(git, 'submit-hook-changed', [
              '-C',
              root,
              'diff-tree',
              '-r',
              '-z',
              '--name-only',
              '--no-renames',
              prepared.subject.base,
              committing.tree,
            ]),
          );
          changed = listed.split('\0').filter((path) => path !== '');
          const hooks = yield* hooked(
            Effect.mapError(
              stepHunks(git, root, built.tree, committing.tree, []),
              (failure) =>
                new GateRefusal('walk-cut', `what the hooks changed could not be read to attribute lines: ${failure.message}`, [
                  'commit again, or land without the hooks that rewrite files',
                ]),
            ),
          );
          const edited = {
            ...prepared.subject,
            built: committing.tree,
            paths: changed,
            holders: prepared.subject.holders === undefined ? undefined : through(hooks, prepared.subject.holders),
          };
          judged = yield* hooked(passed(formedFor(ctx.form, prepared.subject, built.reshaped, checks.before(edited))));
        }
        const carriage: Carriage = {
          stepped: yield* hooked(ctx.read(steppedDelta(built.reshaped))),
          staged: yield* hooked(Effect.flatMap(deltaOf(git, root, built.tree, committing.tree), ctx.read)),
          left: yield* hooked(Effect.flatMap(deltaOf(git, root, committing.tree, committing.left), ctx.read)),
        };
        const unread = unreadIn([carriage.stepped, carriage.staged, carriage.left]);
        if (unread !== null) return yield* hooked(Effect.fail(unread));
        const commit = yield* hooked(
          makeCommit(git, root, {
            tree: committing.tree,
            parents: built.base === null ? [] : [built.base, ...(prepared.merge?.parents ?? [])],
            message: committing.message,
            sign: committing.sign,
          }),
        );
        yield* hooked(
          retirement.landing({
            checkout: RootId.make(checkout),
            commit,
            tree: built.from,
            landed: built.plan.flatMap((one) =>
              one.land === 'own' && one.landed !== null ? [{ path: one.path, landed: one.landed }] : [],
            ),
          }),
        );
        const intent = built.base === null ? null : `${job}:${attempt}`;
        if (intent !== null && built.base !== null)
          yield* hooked(
            intents.intend(
              intent,
              input.projectId,
              root,
              built.base,
              committing.tree,
              prepared.merge,
              prepared.merge === undefined ? undefined : commit,
              ref,
            ),
          );
        const carriedPaths = new Set(changed);
        const submitted: Extract<SubmitReceipt, { readonly status: 'landed' }> = {
          status: 'landed',
          checkout,
          commit,
          subject: committing.message.split(/\r?\n/, 1)[0] ?? committing.message,
          committed: [...changed].sort(),
          carried: built.plan.flatMap((one) =>
            one.holders.length > 0 && carriedPaths.has(one.path) ? [{ path: one.path, holders: one.holders }] : [],
          ),
          unattributed: selection.unattributed.length === 0 ? undefined : selection.unattributed,
          unmatched: selection.unmatched.length === 0 ? undefined : selection.unmatched,
          watched: judged.watched.length === 0 ? undefined : judged.watched,
          carriedViolations: judged.carriedViolations.length === 0 ? undefined : judged.carriedViolations,
          rechecked: judged.rechecked === undefined || judged.rechecked.length === 0 ? undefined : judged.rechecked,
          bodies: judged.bodies === undefined || Object.keys(judged.bodies).length === 0 ? undefined : judged.bodies,
          unjudged: judged.unjudged.length === 0 ? undefined : judged.unjudged,
          formatSkipped: built.formatSkipped ? true : undefined,
          unrecorded: [
            {
              step: 'receipt',
              reason:
                'Publication is confirmed, but the call ended before its index, hooks, change record, after-checks and task labels were all confirmed; read_changes and check_rules show their current standing.',
            },
          ],
        };
        yield* hooked(ctx.witness(commit, ref, submitted));
        place ??= lanes.commits.position();
        yield* stage(`attempt ${attempt}: publishing ${commit.slice(0, 10)} onto ${ref}`);
        const published = yield* hooked(
          lanes.commits.enter(root, publish(git, hosted, root, prepared, commit, changed, job, bases, committing.tree), place).pipe(
            Effect.catchTags({
              HoldStalled: (failure) => laneFailed(root, failure),
              HoldCut: (failure) => laneFailed(root, failure),
              ReentrantCall: (failure) => laneFailed(root, failure),
            }),
            Effect.tapError((failure) =>
              intent === null || (failure._tag === 'GateRefusal' && failure.code === 'landing-cut') ? Effect.void : intents.forget(intent),
            ),
          ),
        );
        if (published._tag === 'moved') {
          if (intent !== null) yield* intents.forget(intent);
          if (committing.left !== built.tree) {
            earlier = both(earlier ?? NOTHING_CARRIED, yield* carry(built.tree, committing.left, built.reshaped));
            continue;
          }
          rebased = yield* onto(prepared, yield* headOf(git, root));
          continue;
        }
        const posted = committing.after.has('post-commit')
          ? yield* landedHook(git, hosted, trees, root, prepared.places, published.commit, COMMITTING)
          : null;
        return {
          landed: {
            carriage,
            commit: published.commit,
            intent,
            built,
            judged,
            changed,
            unsynced: published.unsynced,
            hooked: committing,
            posted,
            earlier: earlier ?? NOTHING_CARRIED,
            conclusion: published.conclusion,
            receipt: submitted,
          },
          emptied: null,
          ...selection,
        };
      }
    }).pipe(Effect.ensuring(Effect.forEach(held, produce.release, { discard: true }))),
  );
  if (outcome._tag === 'Failure') return yield* Effect.fail(withEarlier(earlier)(outcome.failure));
  return outcome.success;
});
