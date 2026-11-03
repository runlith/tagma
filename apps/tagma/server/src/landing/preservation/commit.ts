import { createHash } from 'node:crypto';
import { Clock, Effect, Exit, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import type { PreparedChange } from '../../change-record/contract/service/prepared.js';
import { gitAnswer, type OwnGitFailed, runGit, runGitBytes } from '../../platform/git/ownGit.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { RequestKey } from '../../platform/contract/wire/ids.js';
import { LandingLanes } from '../land/lanes.js';
import { headRef } from '../../platform/git/publish.js';
import { openOperation, placesOf } from '../../platform/git/places.js';
import { type SettleEntry, settleIndex } from '../../platform/git/settle.js';
import {
  PreservationCommit,
  PreservationConflict,
  PreservationFailed,
  PreservationLost,
  PreservationRefused,
  PreservationUnavailable,
  type PreservationFailure,
  type PreservationReceipt,
  type PreservedWorktree,
} from '../../worktrees/contract/service/preservation.js';
import { type Intent, type IntentLifecycle, intentLifecycle } from '../store/intentLifecycle.js';

const KEY_REFS = 'refs/tagma/preservation/';

const OPEN_PAGE = 64;

type Witnessed = Intent & { readonly commit: string; readonly witnessedAt: Date };

type Proof =
  | { readonly _tag: 'present'; readonly commit: string }
  | { readonly _tag: 'absent' }
  | { readonly _tag: 'unreadable'; readonly detail: string };

type Receipted = Effect.Effect<PreservationReceipt, PreservationFailure>;

export type PreservationRecovery = {
  readonly settled: readonly string[];
  readonly lost: readonly string[];
  readonly unsettled: readonly { readonly key: string; readonly reason: string }[];
};

const keyRef = (key: string): string => `${KEY_REFS}${createHash('sha256').update(key).digest('hex')}`;

const messageOf = (prepared: PreparedChange<PreservedWorktree>): string => {
  const worktree = prepared.subject.caller;
  const holders = worktree?.holders ?? [...new Set(prepared.built.plan.flatMap((one) => one.writers))];
  const named = worktree === undefined ? '' : `${worktree.name}: `;
  return `${named}the work left uncommitted when the worktree was deleted\n\n${holders.length === 0 ? 'No thread holds these lines.' : `Lines held by ${holders.join(', ')}.`}\n`;
};

const receiptOf = (key: RequestKey, intent: Witnessed): PreservationReceipt => ({
  key,
  commit: intent.commit,
  witness: keyRef(key),
});

const witnessedOf = (intent: Intent): Witnessed | null =>
  intent.commit === null || intent.witnessedAt === null ? null : { ...intent, commit: intent.commit, witnessedAt: intent.witnessedAt };

const proofOf = (answer: { readonly status: number; readonly stdout: string; readonly stderr: string }): Proof =>
  answer.status === 0
    ? { _tag: 'present', commit: answer.stdout.trim() }
    : answer.status === 1
      ? { _tag: 'absent' }
      : { _tag: 'unreadable', detail: answer.stderr.trim() };

const named = (out: string): readonly string[] => out.split('\0').filter((path) => path !== '');

export const preservation = Effect.fnUntraced(function* (input: { readonly lifecycle: IntentLifecycle; readonly startedAt: Date }) {
  const { lifecycle, startedAt } = input;
  const git = yield* Git;
  const { commits } = yield* LandingLanes;
  const laned = <A>(
    key: RequestKey,
    checkout: string,
    work: Effect.Effect<A, PreservationFailure>,
  ): Effect.Effect<A, PreservationFailure> =>
    Effect.catchTags(commits.enter(checkout, work), {
      HoldStalled: (failure) => Effect.fail(new PreservationUnavailable({ key, cause: 'lane', detail: failure.message })),
      HoldCut: (failure) => Effect.fail(new PreservationUnavailable({ key, cause: 'lane', detail: failure.message })),
      ReentrantCall: (failure) => Effect.fail(new PreservationUnavailable({ key, cause: 'lane', detail: failure.message })),
    });

  const stored = <A>(key: RequestKey, work: Effect.Effect<A, StoreFailure>) =>
    Effect.mapError(work, (failure) => new PreservationUnavailable({ key, cause: 'store', detail: failure.message }));

  const asked = <A>(key: RequestKey, work: Effect.Effect<A, OwnGitFailed>) =>
    Effect.mapError(work, (failure) =>
      failure.ran
        ? new PreservationFailed({ key, detail: `${failure.op}: ${failure.message}` })
        : new PreservationUnavailable({ key, cause: 'git', detail: failure.message }),
    );

  const proved = (key: RequestKey, repository: string) =>
    Effect.map(
      asked(key, gitAnswer(git, 'preservation-proof', ['--git-dir', repository, 'rev-parse', '--verify', '-q', keyRef(key)])),
      proofOf,
    );

  const standing = (key: RequestKey, checkout: string, ref: string) =>
    Effect.map(asked(key, gitAnswer(git, 'preservation-ref', ['-C', checkout, 'rev-parse', '--verify', '-q', `${ref}^{commit}`])), proofOf);

  const lostOf = (key: RequestKey, intent: Witnessed, proof: Proof | null): PreservationLost => {
    const detail =
      proof === null || proof._tag === 'absent'
        ? `nothing proves ${intent.commit} reached ${intent.ref}, and it is never published twice`
        : proof._tag === 'unreadable'
          ? proof.detail
          : `${keyRef(key)} names ${proof.commit}`;
    return new PreservationLost({ key, commit: intent.commit, detail });
  };

  const lost = (key: RequestKey, intent: Witnessed, proof: Proof): Effect.Effect<never, PreservationFailure> =>
    Effect.andThen(stored(key, lifecycle.lose(key)), Effect.fail(lostOf(key, intent, proof)));

  const blobsAt = (key: RequestKey, intent: Witnessed, sha: string, paths: readonly string[]) =>
    Effect.map(
      asked(
        key,
        runGitBytes(git, 'preservation-blobs', [
          '--git-dir',
          intent.repository,
          '--literal-pathspecs',
          'ls-tree',
          '-z',
          '--full-tree',
          sha,
          '--',
          ...paths,
        ]),
      ),
      (out) => {
        const blobs = new Map<string, string>();
        for (const record of named(out)) {
          const tab = record.indexOf('\t');
          blobs.set(record.slice(tab + 1), record.slice(0, tab).split(' ')[2] ?? '');
        }
        return blobs;
      },
    );

  const entriesOf = Effect.fnUntraced(function* (
    key: RequestKey,
    intent: Witnessed,
  ): Effect.fn.Return<readonly SettleEntry[], PreservationFailure> {
    const changed = named(
      yield* asked(
        key,
        runGitBytes(git, 'preservation-changed', [
          '--git-dir',
          intent.repository,
          'diff-tree',
          '-r',
          '--no-commit-id',
          '--name-only',
          '-z',
          intent.base,
          intent.commit,
        ]),
      ),
    );
    if (changed.length === 0) return [];
    const before = yield* blobsAt(key, intent, intent.base, changed);
    const after = yield* blobsAt(key, intent, intent.commit, changed);
    return changed.map((path) => ({ path, base: before.get(path) ?? null, landed: after.get(path) ?? null }));
  });

  const settleCheckout = Effect.fn('PreservationCommit.settleCheckout')(function* (
    key: RequestKey,
    intent: Witnessed,
  ): Effect.fn.Return<void, PreservationFailure> {
    const alive = yield* asked(key, gitAnswer(git, 'preservation-checkout', ['-C', intent.checkout, 'rev-parse', '--git-dir']));
    if (alive.status !== 0) return;
    const entries = yield* entriesOf(key, intent);
    if (entries.length === 0) return;
    const settlement = yield* laned(
      key,
      intent.checkout,
      Effect.mapError(
        Effect.flatMap(placesOf(git, intent.checkout), (places) => settleIndex(git, intent.checkout, places, intent.ref, entries)),
        (failure) => new PreservationUnavailable({ key, cause: 'index', detail: failure.message }),
      ),
    );
    const unsynced = [...settlement.paths].flatMap(([path, outcome]) => (outcome === 'synced' ? [] : [path]));
    if (settlement.moved || unsynced.length > 0) {
      const detail = settlement.moved
        ? `${intent.ref} moved while ${intent.checkout} was settled`
        : `${intent.checkout} still indexes ${unsynced.slice(0, 8).join(', ')}`;
      return yield* new PreservationUnavailable({ key, cause: 'index', detail });
    }
  });

  const dropProof = Effect.fnUntraced(function* (key: RequestKey, intent: Witnessed): Effect.fn.Return<void, PreservationFailure> {
    const dropped = yield* Effect.result(
      asked(key, runGit(git, 'preservation-unproof', ['--git-dir', intent.repository, 'update-ref', '-d', keyRef(key), intent.commit])),
    );
    if (dropped._tag === 'Failure' && (yield* proved(key, intent.repository))._tag !== 'absent') return yield* dropped.failure;
  });

  const finish = Effect.fn('PreservationCommit.finish')(function* (
    key: RequestKey,
    intent: Witnessed,
  ): Effect.fn.Return<PreservationReceipt, PreservationFailure> {
    yield* settleCheckout(key, intent);
    yield* dropProof(key, intent);
    yield* stored(key, lifecycle.settle(key));
    return receiptOf(key, intent);
  });

  const received = (key: RequestKey, intent: Witnessed): Receipted =>
    Effect.andThen(stored(key, lifecycle.receive(key, intent.commit, new Date())), finish(key, intent));

  const resume = (key: RequestKey, intent: Witnessed): Receipted =>
    Effect.flatMap(proved(key, intent.repository), (proof) =>
      proof._tag === 'present' && proof.commit === intent.commit ? received(key, intent) : lost(key, intent, proof),
    );

  const answered = (key: RequestKey, intent: Witnessed, hasReceipt: boolean): Receipted =>
    intent.phase === 'settled'
      ? Effect.succeed(receiptOf(key, intent))
      : intent.phase === 'lost'
        ? Effect.fail(lostOf(key, intent, null))
        : hasReceipt
          ? finish(key, intent)
          : resume(key, intent);

  const land = (key: RequestKey, intent: Intent, message: string): Effect.Effect<Witnessed, PreservationFailure> => {
    let witnessed = false;
    return laned(
      key,
      intent.checkout,
      Effect.gen(function* () {
        const operation = yield* asked(key, openOperation(git, intent.checkout));
        if (operation !== null) {
          return yield* new PreservationRefused({
            key,
            reason: 'mid-operation',
            detail: `a ${operation} is in progress in ${intent.checkout}`,
          });
        }
        const ref = yield* asked(key, headRef(git, intent.checkout));
        const now = yield* standing(key, intent.checkout, intent.ref);
        if (ref !== intent.ref || now._tag !== 'present' || now.commit !== intent.base) {
          return yield* new PreservationRefused({ key, reason: 'moved', detail: `${intent.ref} no longer stands at ${intent.base}` });
        }
        const commit = yield* asked(
          key,
          runGit(git, 'preservation-commit', ['-C', intent.checkout, 'commit-tree', intent.tree, '-p', intent.base, '-F', '-'], {
            stdin: message,
          }),
        );
        const witnessedAt = new Date(yield* Clock.currentTimeMillis);
        yield* stored(key, lifecycle.witness(key, commit, witnessedAt));
        witnessed = true;
        const publishing: Witnessed = { ...intent, phase: 'publishing', commit, witnessedAt };
        const sent = yield* asked(
          key,
          gitAnswer(git, 'preservation-publish', ['-C', intent.checkout, 'update-ref', '--stdin', '-m', `tagma preservation ${key}`], {
            stdin: `update ${intent.ref} ${commit} ${intent.base}\ncreate ${keyRef(key)} ${commit}\n`,
          }),
        );
        if (sent.status === 0) return publishing;
        const proof = yield* proved(key, intent.repository);
        if (proof._tag === 'present' && proof.commit === commit) return publishing;
        const after = yield* standing(key, intent.checkout, intent.ref);
        if (after._tag === 'present' && after.commit === intent.base)
          return yield* new PreservationFailed({ key, detail: sent.stderr.trim() });
        return yield* lost(key, publishing, proof);
      }),
    ).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) || witnessed ? Effect.void : stored(key, lifecycle.forget(key, intent.at)))));
  };

  const preserve = Effect.fn('PreservationCommit.commit')(function* (
    key: RequestKey,
    prepared: PreparedChange<PreservedWorktree>,
  ): Effect.fn.Return<PreservationReceipt, PreservationFailure> {
    const checkout = prepared.subject.root;
    const { base, tree, changed } = prepared.built;
    const found = yield* stored(key, lifecycle.read(key));
    if (found !== null && (found.intent.checkout !== checkout || found.intent.base !== base || found.intent.tree !== tree)) {
      const { intent } = found;
      return yield* new PreservationConflict({ key, recorded: { checkout: intent.checkout, base: intent.base, tree: intent.tree } });
    }
    const known = found === null ? null : witnessedOf(found.intent);
    if (found !== null && known !== null) return yield* answered(key, known, found.receipt !== null);
    if (base === null) return yield* new PreservationRefused({ key, reason: 'no-base', detail: `${checkout} stands on no commit` });
    if (changed.length === 0)
      return yield* new PreservationRefused({ key, reason: 'nothing-changed', detail: `${checkout} holds nothing to preserve` });
    const ref = yield* asked(key, headRef(git, checkout));
    const repository = yield* asked(
      key,
      runGit(git, 'preservation-repository', ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir']),
    );
    const intent: Intent = {
      key,
      kind: 'preservation',
      projectId: prepared.subject.projectId,
      phase: 'intended',
      repository,
      checkout,
      ref,
      base,
      tree,
      commit: null,
      witnessedAt: null,
      at: new Date(yield* Clock.currentTimeMillis),
    };
    const abandoned = found !== null && found.intent.at < startedAt ? found.intent.at : null;
    if (found !== null && abandoned === null) return yield* claimed(key);
    if (!(yield* stored(key, lifecycle.claim(intent, abandoned)))) {
      const now = yield* stored(key, lifecycle.read(key));
      const settled = now === null ? null : witnessedOf(now.intent);
      if (now !== null && settled !== null) return yield* answered(key, settled, now.receipt !== null);
      return yield* claimed(key);
    }
    return yield* received(key, yield* land(key, intent, messageOf(prepared)));
  });

  const claimed = (key: RequestKey): Effect.Effect<never, PreservationUnavailable> =>
    Effect.fail(
      new PreservationUnavailable({
        key,
        cause: 'claimed',
        detail: 'another call is publishing under this key; ask again once it has answered',
      }),
    );

  const recoverOne = (intent: Intent): Effect.Effect<PreservationFailure | null> => {
    const key = intent.key as RequestKey;
    const known = witnessedOf(intent);
    const settled: Effect.Effect<unknown, PreservationFailure> =
      known === null
        ? stored(key, lifecycle.forget(key, intent.at))
        : intent.phase === 'published'
          ? finish(key, known)
          : Effect.flatMap(proved(key, intent.repository), (proof) =>
              proof._tag === 'present' && proof.commit === known.commit ? received(key, known) : lost(key, known, proof),
            );
    return Effect.map(Effect.result(settled), (answer) => (answer._tag === 'Success' ? null : answer.failure));
  };

  const recover: Effect.Effect<PreservationRecovery, StoreFailure> = Effect.gen(function* () {
    const settled: string[] = [];
    const lostKeys: string[] = [];
    const unsettled: { readonly key: string; readonly reason: string }[] = [];
    let after: { readonly at: Date; readonly key: string } | null = null;
    for (;;) {
      const page: readonly Intent[] = yield* lifecycle.open('preservation', after, OPEN_PAGE);
      for (const intent of page) {
        if (intent.at >= startedAt) continue;
        const failure = yield* recoverOne(intent);
        if (failure === null) settled.push(intent.key);
        else if (failure._tag === 'PreservationLost') lostKeys.push(intent.key);
        else unsettled.push({ key: intent.key, reason: failure.message });
      }
      const last: Intent | undefined = page.at(-1);
      if (last === undefined || page.length < OPEN_PAGE) return { settled, lost: lostKeys, unsettled };
      after = { at: last.at, key: last.key };
    }
  });

  return {
    ...PreservationCommit.of({
      commit: preserve,
      readReceipt: Effect.fn('PreservationCommit.readReceipt')(function* (key) {
        const found = yield* stored(key, lifecycle.read(key));
        const known = found === null ? null : witnessedOf(found.intent);
        if (found === null || known === null) return null;
        return yield* answered(key, known, found.receipt !== null);
      }),
    }),
    recover,
  };
});

export const preservationCommitLayer = (
  after: Effect.Effect<void>,
): Layer.Layer<PreservationCommit, never, MachineStore | MachineUnits | Git> =>
  Layer.effect(
    PreservationCommit,
    Effect.gen(function* () {
      const preserved = yield* preservation({
        lifecycle: intentLifecycle((yield* MachineStore).db, yield* MachineUnits),
        startedAt: new Date(yield* Clock.currentTimeMillis),
      });
      yield* Effect.forkScoped(
        after.pipe(
          Effect.andThen(preserved.recover),
          Effect.tap((report) =>
            report.unsettled.length === 0 && report.lost.length === 0
              ? Effect.void
              : Effect.logWarning('preservations left open at boot', report),
          ),
          Effect.tapError((failure) => Effect.logWarning('open preservations could not be read', { failure: failure.message })),
        ),
      );
      return PreservationCommit.of(preserved);
    }),
  );
