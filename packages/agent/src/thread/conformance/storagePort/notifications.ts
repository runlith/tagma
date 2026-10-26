import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Effect, type Scope } from 'effect';
import type { ThreadStorageFactory } from '../storagePort';
import { INSTANCE, OTHER_INSTANCE, OWNER, SCOPE, settlePatch, started, startInput } from './support';
export function describeRunNotifications<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: settled run notification attempts`, () => {
    test(
      'two instances claiming settled runs never both get the same row',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const mine = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const theirs = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(mine.createRun(startInput(thread)));
        yield* mine.settleRun(run.id, { ...(yield* settlePatch('completed')), heartbeatAt: new Date(0) });
        const claim = { heartbeatBefore: new Date(1), now: new Date(1), limit: 10, maxAttempts: 10 };
        const [ours, others] = yield* Effect.all([mine.claimSettledForNotification(claim), theirs.claimSettledForNotification(claim)], {
          concurrency: 2,
        });
        expect(ours.claims.length + others.claims.length).toBe(1);
        expect((yield* mine.claimSettledForNotification(claim)).claims).toHaveLength(0);
      }),
    );
    test(
      'notification records round-trip and a replaced attempt cannot write, heartbeat or confirm',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        const settled = yield* runs.settleRun(run.id, {
          ...(yield* settlePatch('aborted')),
          heartbeatAt: new Date(0),
          settledBy: 'reader',
        });
        const first = settled?.settledNotification;
        if (!first) return yield* Effect.die('The terminal write did not seed its notification attempt.');
        expect(settled?.settledBy).toBe('reader');
        expect(first.id.startsWith(`${run.id}:`)).toBe(true);
        const failed = {
          ...first,
          finishedAt: new Date(0).toISOString(),
          phase: 'subscriber' as const,
          subscriber: 'reports',
          lastFailure: {
            attemptId: first.id,
            at: new Date(0).toISOString(),
            phase: 'subscriber' as const,
            subscriber: 'reports',
            cause: [
              {
                kind: 'failure' as const,
                tag: 'ThreadCallBroke',
                port: null,
                message: 'snapshot failed',
                detail: 'original cause',
                fiberId: null,
              },
            ],
          },
        };
        expect(yield* runs.writeSettledNotification(run.id, failed, first.id)).toBe(true);
        expect((yield* runs.latestRun(thread.id))?.settledNotification).toEqual(failed);
        const [claim] = (yield* runs.claimSettledForNotification({
          heartbeatBefore: new Date(1),
          now: new Date(0),
          limit: 1,
          maxAttempts: 2,
        })).claims;
        if (!claim?.settledNotification) return yield* Effect.die('Reclaim did not seed its next attempt.');
        expect(claim.settledBy).toBe('reader');
        expect(claim.settledNotification.id).not.toBe(first.id);
        expect(claim.settledNotification.lastFailure).toEqual(failed.lastFailure);
        expect(yield* runs.writeSettledNotification(run.id, failed, first.id)).toBe(false);
        expect(yield* runs.markSettledNotified(run.id, new Date(500), first)).toBe(false);
        yield* runs.heartbeatSettledClaim(run.id, new Date(500), first.id);
        expect((yield* runs.latestRun(thread.id))?.heartbeatAt.getTime()).toBe(0);
        expect(yield* runs.markSettledNotified(run.id, new Date(500), claim.settledNotification)).toBe(true);
        const confirmed = yield* runs.latestRun(thread.id);
        expect(confirmed?.settledNotifiedAt?.getTime()).toBe(500);
        expect(confirmed?.settledNotification?.lastFailure).toEqual(failed.lastFailure);
      }),
    );
    test(
      'a confirmed settle hook is never claimed again',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        yield* runs.settleRun(run.id, { ...(yield* settlePatch('failed')), heartbeatAt: new Date(0) });
        const claim = { heartbeatBefore: new Date(1), now: new Date(0), limit: 10, maxAttempts: 10 };
        const [claimed] = (yield* runs.claimSettledForNotification(claim)).claims;
        expect(claimed?.id).toBe(run.id);
        yield* runs.markSettledNotified(run.id, new Date(yield* Clock.currentTimeMillis), claimed?.settledNotification ?? null);
        expect(yield* runs.claimSettledForNotification(claim)).toEqual({ claims: [], exhausted: [] });
      }),
    );
    test(
      'a settle hook nobody could confirm stops being claimed after its budget',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        yield* runs.settleRun(run.id, { ...(yield* settlePatch('failed')), heartbeatAt: new Date(0) });
        const claim = { heartbeatBefore: new Date(1), now: new Date(0), limit: 10, maxAttempts: 2 };
        expect((yield* runs.claimSettledForNotification(claim)).claims).toHaveLength(1);
        expect((yield* runs.claimSettledForNotification(claim)).claims).toHaveLength(1);
        expect((yield* runs.claimSettledForNotification(claim)).claims).toHaveLength(0);
      }),
    );
  });
}
