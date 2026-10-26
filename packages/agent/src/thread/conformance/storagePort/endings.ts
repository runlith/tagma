import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Clock, Effect, type Scope } from 'effect';
import type { ThreadStorageFactory } from '../storagePort';
import { INSTANCE, OTHER_INSTANCE, OTHER_SCOPE, OWNER, SCOPE, settlePatch, started, startInput } from './support';
export function describeThreadEndingsPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: thread run endings`, () => {
    test(
      'settled runs read newest first in pages that continue after the last row, counting the selected threads',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const ended: string[] = [];
        for (const [at, of] of [
          [1_000, thread],
          [2_000, other],
          [3_000, thread],
        ] as const) {
          const run = yield* started(runs.createRun(startInput(of)));
          yield* runs.settleRun(run.id, { ...(yield* settlePatch('completed')), finishedAt: new Date(at) });
          ended.push(run.id);
        }
        yield* started(runs.createRun(startInput(other)));
        const [oldest, middle, newest] = ended as [string, string, string];
        const both = [thread.id, other.id];
        const metadata = yield* harness.aggregate.metadataOf([thread.id, other.id, 'no-such-thread']);
        expect(metadata.map((row) => row.id).sort()).toEqual(both.slice().sort());
        const first = yield* runs.settledRuns({ threadIds: both, limit: 2 });
        expect(first.total).toBe(3);
        expect(first.rows.map((row) => row.id)).toEqual([newest, middle]);
        const last = first.rows[1]!;
        const second = yield* runs.settledRuns({ threadIds: both, limit: 2, after: { finishedAt: last.finishedAt!, id: last.id } });
        expect(second.rows.map((row) => row.id)).toEqual([oldest]);
        const ofThread = yield* runs.settledRuns({ limit: 10, threadIds: [thread.id] });
        expect(ofThread.total).toBe(2);
        expect(ofThread.rows.map((row) => row.id)).toEqual([newest, oldest]);
        const latest = yield* runs.newestSettled([thread.id, other.id, 'no-such-thread'], 1);
        const depth = yield* runs.newestSettled([thread.id, other.id], 2);
        expect(depth.map((row) => `${row.threadId}:${row.id}`).sort()).toEqual(
          [`${thread.id}:${newest}`, `${thread.id}:${oldest}`, `${other.id}:${middle}`].sort(),
        );
        expect(latest.map((row) => `${row.threadId}:${row.id}`).sort()).toEqual([`${thread.id}:${newest}`, `${other.id}:${middle}`].sort());
      }),
    );
    test(
      'a spent notification is reported exhausted once, and only redelivery of an exhausted one claims it again',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        expect(yield* runs.redeliverSettled(run.id, 1)).toBe(false);
        yield* runs.settleRun(run.id, { ...(yield* settlePatch('failed')), heartbeatAt: new Date(0) });
        expect(yield* runs.redeliverSettled(run.id, 1)).toBe(false);
        const claim = { heartbeatBefore: new Date(1), now: new Date(0), limit: 10, maxAttempts: 1 };
        const first = yield* runs.claimSettledForNotification(claim);
        expect(first.claims.map((row) => [row.id, row.attempt])).toEqual([[run.id, 1]]);
        expect(first.exhausted).toEqual([]);
        const spent = yield* runs.claimSettledForNotification(claim);
        expect(spent.claims).toEqual([]);
        expect(spent.exhausted.map((row) => [row.id, row.attempts])).toEqual([[run.id, 1]]);
        expect(yield* runs.claimSettledForNotification(claim)).toEqual({ claims: [], exhausted: [] });
        expect(yield* runs.redeliverSettled(run.id, 1)).toBe(true);
        const again = yield* runs.claimSettledForNotification(claim);
        expect(again.claims.map((row) => row.attempt)).toEqual([1]);
        yield* runs.markSettledNotified(run.id, new Date(yield* Clock.currentTimeMillis), again.claims[0]?.settledNotification ?? null);
        expect(yield* runs.redeliverSettled(run.id, 1)).toBe(false);
      }),
    );
    test(
      'every claim takes a fresh identity, so a claimant superseded after redelivery writes and confirms nothing',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        yield* runs.settleRun(run.id, { ...(yield* settlePatch('failed')), heartbeatAt: new Date(0) });
        const claim = { heartbeatBefore: new Date(1), now: new Date(0), limit: 10, maxAttempts: 1 };
        const [stale] = (yield* runs.claimSettledForNotification(claim)).claims;
        yield* runs.claimSettledForNotification(claim);
        yield* runs.redeliverSettled(run.id, 1);
        const [fresh] = (yield* runs.claimSettledForNotification(claim)).claims;
        expect(fresh?.settledNotification?.id).not.toBe(stale?.settledNotification?.id);
        const superseded = stale!.settledNotification!;
        expect(yield* runs.writeSettledNotification(run.id, superseded, superseded.id)).toBe(false);
        expect(yield* runs.markSettledNotified(run.id, new Date(yield* Clock.currentTimeMillis), superseded)).toBe(false);
        expect(yield* runs.markSettledNotified(run.id, new Date(yield* Clock.currentTimeMillis), fresh!.settledNotification)).toBe(true);
      }),
    );
    test(
      'endings and redelivery never reach another scope`s runs',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const mine = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const foreign = harness.runs({ ownerId: OTHER_INSTANCE, scope: OTHER_SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: OTHER_SCOPE });
        const run = yield* started(foreign.createRun(startInput(thread)));
        yield* foreign.settleRun(run.id, { ...(yield* settlePatch('completed')), heartbeatAt: new Date(0) });
        expect(yield* mine.settledRuns({ threadIds: [thread.id], limit: 10 })).toEqual({ rows: [], total: 0 });
        expect(yield* mine.newestSettled([thread.id], 1)).toEqual([]);
        expect(yield* mine.redeliverSettled(run.id, 0)).toBe(false);
      }),
    );
  });
}
