import { Cause, Clock, Effect, Exit, Schedule, Stream } from 'effect';
import { ThreadModelRefused } from '@runlith/agent/collaboration/model';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { threadRunLimited } from '@runlith/agent/thread/rows';
import { ThreadMissing } from '@runlith/agent/thread/ThreadBorder';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { DefaultAccounts } from '../../providers/contract/service/accounts.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { HarnessMoves } from '../../threads/contract/service/harness.js';

const STEP_WAIT_MS = 3 * 60_000;

const ASKED_AGAIN: ReadonlySet<string> = new Set(['thread-running', 'session-starting', 'session-uncertain']);

const GONE: ReadonlySet<string> = new Set(['thread-gone', 'session-deleting', 'harness-moved', 'harness-missing']);

const askedAgain = (failure: unknown): boolean =>
  (failure instanceof ThreadModelRefused && failure.reason === 'step-unreached') ||
  (failure instanceof GateRefusal && ASKED_AGAIN.has(failure.code)) ||
  (failure instanceof ThreadStorageFailed && failure.call === 'model.resume');

const gone = (failure: unknown): boolean => failure instanceof ThreadMissing || (failure instanceof GateRefusal && GONE.has(failure.code));

const warned =
  (what: string, attrs: Record<string, unknown>) =>
  (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
    Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning(what, { ...attrs, cause });

type Draining = { readonly provider: string; again: boolean };

export const carryDefaultMoves = Effect.gen(function* () {
  const defaults = yield* DefaultAccounts;
  const moves = yield* HarnessMoves;
  const harness = yield* ThreadHarness;
  const scope = yield* Effect.scope;
  const draining = new Map<string, Draining>();
  const standing = (provider: string) =>
    Effect.map(defaults.defaultAccount(provider), (row) => (row.account === null ? null : String(row.account)));

  const attempt = Effect.fnUntraced(function* (threadId: string, provider: string) {
    const ledger = harness.runs.ledger();
    const handle = harness.threads.handle(threadId, OPERATOR_PRINCIPAL);
    const latest = yield* ledger.latestRun(threadId);
    const resting = latest !== null && latest.status !== 'running';
    const stopped =
      resting && latest.status === 'aborted' && latest.settledBy === 'model' ? { status: 'stopped' as const, runId: latest.id } : null;
    const limited = resting && threadRunLimited(latest) ? latest.id : null;
    const now = yield* Clock.currentTimeMillis;
    const { moved } = yield* handle.carryModel({
      threadId,
      request: { key: crypto.randomUUID(), deadline: new Date(now + STEP_WAIT_MS) },
      move: (resume) =>
        Effect.flatMap(standing(provider), (account) =>
          Effect.map(moves.follow(threadId, provider, account), (followed) => (followed === null ? null : { ...followed, resume })),
        ),
      running: (failure) => failure instanceof GateRefusal && failure.code === 'thread-running',
      stopped,
      restoreOnFailure: true,
    });
    if (moved?.left == null || limited === null) return;
    if ((yield* ledger.latestRun(threadId))?.id === limited) yield* handle.continue();
  });

  const settled = Effect.fn('carryDefaultMoves.settle')(
    function* (threadId: string, provider: string) {
      yield* attempt(threadId, provider).pipe(Effect.retry({ schedule: Schedule.spaced('1 second'), while: askedAgain }));
    },
    (work, threadId) =>
      work.pipe(
        Effect.catchIf(gone, () => Effect.void),
        Effect.tapCause(warned('a thread did not follow the moved default account', { threadId })),
      ),
  );

  const follow = (threadId: string, provider: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const held = draining.get(threadId);
      if (held !== undefined) {
        held.again = true;
        return Effect.void;
      }
      const state: Draining = { provider, again: true };
      draining.set(threadId, state);
      const more = () => {
        if (state.again) {
          state.again = false;
          return true;
        }
        draining.delete(threadId);
        return false;
      };
      const drain = Effect.gen(function* () {
        while (more()) yield* settled(threadId, state.provider);
      }).pipe(
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            if (draining.get(threadId) === state) draining.delete(threadId);
            return Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) && state.again
              ? follow(threadId, state.provider)
              : Effect.void;
          }),
        ),
      );
      return Effect.asVoid(Effect.forkIn(drain, scope));
    });

  const moved = Effect.fn('carryDefaultMoves.moved')(
    function* (provider: string) {
      for (const held of draining.values()) if (held.provider === provider) held.again = true;
      const account = yield* standing(provider);
      if (account === null) return;
      for (const threadId of yield* moves.lagging(provider, account)) yield* follow(threadId, provider);
    },
    (work, provider) => work.pipe(Effect.tapCause(warned('a moved default account was not followed by its threads', { provider }))),
  );

  yield* Stream.runForEach(defaults.defaultAccountMoved, (provider) => Effect.asVoid(Effect.forkIn(moved(provider), scope)));
});
