import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Data, Effect, Fiber, type Scope } from 'effect';
import { threadCauseOf } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import { InboxConflict, type ThreadInboxItemValues } from '../storage/inbox';
import type { ThreadStorageFactory, ThreadStorageHarness } from './storagePort';
import { gate } from './runLog/support';
const OWNER = 'owner';
const SCOPE = 'scope-a';
const CONTROL_KEY = {
  key: { evidence: { envelope: { namespace: 'final', id: 'owed' } }, digest: 'digest' },
  deadline: new Date(8_640_000_000_000_000),
};
class UnitFailed extends Data.TaggedError('UnitFailed') {}
export function describeThreadInboxPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: thread inbox port`, () => {
    test(
      'an item is accepted once, and every replay answers the item that stands',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const sender = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const values = task('task-1', recipient.id, sender.id, 1_000);
        const races = yield* Effect.all([harness.inbox.put(values), harness.inbox.put(values)], { concurrency: 2 });
        expect(races.filter((answer) => answer.fresh)).toHaveLength(1);
        for (const answer of races) expect(answer.item).toEqual({ ...values, state: 'queued', deliveredToRunId: null });
        expect(yield* harness.inbox.receipt(values.id)).toEqual({ ...values, state: 'queued', deliveredToRunId: null });
        yield* harness.inbox.deliver([values.id], 'run-1');
        const replayed = yield* harness.inbox.put(task('task-1', recipient.id, sender.id, 1_000, 'a sender that rewrote itself'));
        expect(replayed.fresh).toBe(false);
        expect(replayed.item).toEqual({ ...values, state: 'delivered', deliveredToRunId: 'run-1' });
        expect((yield* harness.inbox.put(task('task-2', recipient.id, sender.id, 2_000))).fresh).toBe(true);
        expect(yield* harness.inbox.receipt('task-none')).toBeUndefined();
      }),
    );
    test(
      'deliver binds a queued item, moves a delivered one, and never touches an acknowledged one',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const sender = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(task('answered', recipient.id, sender.id, 1_000));
        yield* harness.inbox.put(task('owed', recipient.id, sender.id, 2_000));
        yield* harness.inbox.put(turn('words', recipient.id, 3_000));
        yield* harness.inbox.deliver(['answered', 'owed', 'not-there'], 'run-torn');
        expect(yield* states(harness, ['answered', 'owed', 'words'])).toEqual([
          ['delivered', 'run-torn'],
          ['delivered', 'run-torn'],
          ['queued', null],
        ]);
        yield* harness.inbox.acknowledge(['answered'], 'run-torn');
        yield* harness.inbox.deliver(['answered', 'owed', 'words'], 'run-successor');
        expect(yield* states(harness, ['answered', 'owed', 'words'])).toEqual([
          ['acknowledged', 'run-torn'],
          ['delivered', 'run-successor'],
          ['delivered', 'run-successor'],
        ]);
        yield* harness.inbox.acknowledge(['owed'], null);
        yield* harness.inbox.put(turn('taken-back', recipient.id, 4_000));
        yield* harness.inbox.acknowledge(['taken-back'], null);
        yield* harness.inbox.put(turn('read', recipient.id, 5_000));
        yield* harness.inbox.acknowledge(['read'], 'run-reader');
        expect(yield* states(harness, ['owed', 'taken-back', 'read'])).toEqual([
          ['acknowledged', 'run-successor'],
          ['acknowledged', null],
          ['acknowledged', 'run-reader'],
        ]);
        yield* harness.inbox.acknowledge(['read'], 'run-later');
        expect(yield* states(harness, ['read'])).toEqual([['acknowledged', 'run-reader']]);
      }),
    );
    test(
      'pending answers the thread`s unacknowledged items oldest first, and only that thread`s',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const sender = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const neighbour = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(turn('third', recipient.id, 3_000));
        yield* harness.inbox.put(signal('first', recipient.id, 1_000));
        yield* harness.inbox.put(task('second', recipient.id, sender.id, 2_000));
        yield* harness.inbox.put(envelope('second-tie', recipient.id, sender.id, 2_000));
        yield* harness.inbox.put(turn('elsewhere', neighbour.id, 500));
        expect((yield* harness.inbox.pending(recipient.id)).map((item) => item.id)).toEqual(['first', 'second', 'second-tie', 'third']);
        expect((yield* harness.inbox.pending(neighbour.id)).map((item) => item.id)).toEqual(['elsewhere']);
        yield* harness.inbox.deliver(['second'], 'run-1');
        yield* harness.inbox.acknowledge(['first', 'third'], 'run-1');
        expect((yield* harness.inbox.pending(recipient.id)).map((item) => [item.id, item.state])).toEqual([
          ['second', 'delivered'],
          ['second-tie', 'queued'],
        ]);
        expect(yield* harness.inbox.pending('thread-none')).toEqual([]);
      }),
    );
    test(
      'arrivals answers what came after a cursor, and the cursor it hands back reads nothing twice',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const neighbour = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(turn('first', recipient.id, 1_000));
        yield* harness.inbox.put(turn('acknowledged', recipient.id, 2_000));
        yield* harness.inbox.acknowledge(['acknowledged'], 'run-1');
        const opening = yield* harness.inbox.arrivals({ threadId: recipient.id, after: null });
        expect(opening.items.map((item) => item.id)).toEqual(['first']);
        expect((yield* harness.inbox.arrivals({ threadId: recipient.id, after: opening.through })).items).toEqual([]);
        yield* harness.inbox.put(turn('elsewhere', neighbour.id, 2_500));
        yield* harness.inbox.put(turn('second', recipient.id, 3_000));
        yield* harness.inbox.put(turn('third', recipient.id, 2_000));
        const since = yield* harness.inbox.arrivals({ threadId: recipient.id, after: opening.through });
        expect(since.items.map((item) => item.id)).toEqual(['third', 'second']);
        expect((yield* harness.inbox.arrivals({ threadId: recipient.id, after: since.through })).items).toEqual([]);
        yield* harness.inbox.put({
          ...envelope('report', recipient.id, neighbour.id, 4_000),
          kind: 'envelope',
          body: { intent: 'report', text: 'Collected answer', inReplyTo: null },
        });
        yield* harness.inbox.acknowledge(['report'], null);
        expect((yield* harness.inbox.arrivals({ threadId: recipient.id, after: since.through })).items).toEqual([]);
        expect(
          (yield* harness.inbox.arrivals({ threadId: recipient.id, after: since.through, reports: 'all' })).items.map((item) => item.id),
        ).toEqual(['report']);
      }),
    );
    test(
      'items of one instant answer in the order the inbox accepted them, whatever their ids',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(turn('zeta', recipient.id, 1_000));
        yield* harness.inbox.put(signal('alpha', recipient.id, 1_000));
        yield* harness.inbox.put(turn('mu', recipient.id, 1_000));
        expect((yield* harness.inbox.pending(recipient.id)).map((item) => item.id)).toEqual(['zeta', 'alpha', 'mu']);
      }),
    );
    test(
      'a write independent of a failing unit lands whole once the unit has rolled back',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(turn('standing', recipient.id, 1_000));
        const writing = gate();
        const doomed = yield* Effect.forkScoped(
          Effect.flip(
            harness.transitions.writeAt(
              recipient.id,
              Effect.fnUntraced(function* ({ tx }) {
                yield* harness.inbox.put(turn('rolled-back', recipient.id, 2_000), tx);
                writing.reach();
                yield* writing.released;
                return yield* new UnitFailed();
              }),
            ),
          ),
        );
        yield* writing.reached;
        const independent = yield* Effect.forkScoped(harness.inbox.put(turn('independent', recipient.id, 3_000)));
        const delivered = yield* Effect.forkScoped(harness.inbox.deliver(['standing'], 'run-independent'));
        writing.release();
        expect(threadCauseOf(yield* Fiber.join(doomed))).toBeInstanceOf(UnitFailed);
        expect((yield* Fiber.join(independent)).fresh).toBe(true);
        yield* Fiber.join(delivered);
        expect(yield* harness.inbox.receipt('rolled-back')).toBeUndefined();
        expect(yield* states(harness, ['standing', 'independent'])).toEqual([
          ['delivered', 'run-independent'],
          ['queued', null],
        ]);
      }),
    );
    test(
      'a put, a delivery and an acknowledgement ride the caller`s unit, and roll back with it',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(turn('standing', recipient.id, 1_000));
        const failed = yield* Effect.flip(
          harness.transitions.writeAt(
            recipient.id,
            Effect.fnUntraced(function* ({ tx }) {
              yield* harness.inbox.put(turn('rolled-back', recipient.id, 2_000), tx);
              yield* harness.inbox.deliver(['standing'], 'run-rolled-back', tx);
              return yield* new UnitFailed();
            }),
          ),
        );
        expect(threadCauseOf(failed)).toBeInstanceOf(UnitFailed);
        expect(yield* harness.inbox.receipt('rolled-back')).toBeUndefined();
        expect(yield* states(harness, ['standing'])).toEqual([['queued', null]]);
        yield* harness.transitions.writeAt(
          recipient.id,
          Effect.fnUntraced(function* ({ tx }) {
            yield* harness.inbox.put(turn('landed', recipient.id, 2_000), tx);
            yield* harness.inbox.acknowledge(['standing'], 'run-landed', tx);
            return null;
          }),
        );
        expect((yield* harness.inbox.pending(recipient.id)).map((item) => item.id)).toEqual(['landed']);
        expect(yield* states(harness, ['standing'])).toEqual([['acknowledged', 'run-landed']]);
      }),
    );
    test(
      'a task a thread sent stays open through every delivery state until one closure ends it; an interrupt, a host`s task and words open none',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const sender = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const neighbour = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(task('owed', recipient.id, sender.id, 1_000));
        yield* harness.inbox.put(interrupt('reason', recipient.id, sender.id, 2_000));
        yield* harness.inbox.put(hostTask('from-host', recipient.id, 3_000));
        yield* harness.inbox.put(envelope('words', recipient.id, sender.id, 4_000));
        yield* harness.inbox.put(task('queued', recipient.id, sender.id, 5_000));
        yield* harness.inbox.put(task('elsewhere', neighbour.id, sender.id, 500));
        const openIds = () => Effect.map(harness.inbox.openRequests(recipient.id), (items) => items.map((item) => item.id));
        expect(yield* openIds()).toEqual(['owed', 'queued']);
        yield* harness.inbox.deliver(['owed'], 'run-1');
        yield* harness.inbox.acknowledge(['owed'], 'run-1');
        expect(yield* openIds()).toEqual(['owed', 'queued']);
        expect((yield* harness.inbox.openRequests(recipient.id))[0]).toMatchObject({ state: 'acknowledged', deliveredToRunId: 'run-1' });
        expect(yield* harness.inbox.closeRequests(['owed', 'words', 'nothing-here'], 'envelope:final:owed')).toEqual(['owed']);
        expect(yield* harness.inbox.closeRequests(['owed'], 'requester-gone')).toEqual([]);
        expect(yield* openIds()).toEqual(['queued']);
        expect(yield* states(harness, ['owed'])).toEqual([['acknowledged', 'run-1']]);
        expect((yield* harness.inbox.openRequests(neighbour.id)).map((item) => item.id)).toEqual(['elsewhere']);
      }),
    );
    test(
      'a closure rides the caller`s unit, and rolls back with it',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const sender = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(task('owed', recipient.id, sender.id, 1_000));
        const failed = yield* Effect.flip(
          harness.transitions.writeAt(
            recipient.id,
            Effect.fnUntraced(function* ({ tx }) {
              yield* harness.inbox.put(envelope('answer', sender.id, recipient.id, 2_000), tx);
              yield* harness.inbox.closeRequests(['owed'], 'answer', tx);
              yield* harness.inbox.intendWake(['answer'], tx);
              return yield* new UnitFailed();
            }),
          ),
        );
        expect(threadCauseOf(failed)).toBeInstanceOf(UnitFailed);
        expect(yield* harness.inbox.pendingWakes(10)).toEqual([]);
        expect((yield* harness.inbox.openRequests(recipient.id)).map((item) => item.id)).toEqual(['owed']);
        expect(yield* harness.inbox.receipt('answer')).toBeUndefined();
        yield* harness.transitions.writeAt(
          recipient.id,
          Effect.fnUntraced(function* ({ tx }) {
            const open = yield* harness.inbox.openRequests(recipient.id, tx);
            yield* harness.inbox.closeRequests(
              open.map((item) => item.id),
              'answer',
              tx,
            );
            return null;
          }),
        );
        expect(yield* harness.inbox.openRequests(recipient.id)).toEqual([]);
      }),
    );
    test(
      'control reads one request, one item and a requester`s newest taken request, and commits its writes and wakes together',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const requester = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const holder = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(task('older', holder.id, requester.id, 1_000));
        yield* harness.inbox.put(task('newer', holder.id, requester.id, 2_000));
        yield* harness.inbox.put(task('waiting', holder.id, requester.id, 3_000));
        yield* harness.inbox.deliver(['older', 'newer'], 'run-1');
        const outcome = yield* harness.inbox.control<{
          newest: string | null;
          waiting: string | null;
          older: string | null;
        }>(
          holder.id,
          {
            decide: Effect.fnUntraced(function* (view) {
              const newest = yield* view.newestTaken(holder.id, requester.id);
              const waiting = yield* view.request('waiting');
              const older = yield* view.item('older');
              return {
                apply: Effect.fnUntraced(function* (writes) {
                  yield* writes.put(envelope('answer', requester.id, holder.id, 4_000));
                  yield* writes.put(envelope('copy', holder.id, holder.id, 4_000));
                  yield* writes.closeRequests(['older', 'newer'], 'answer');
                  yield* writes.intendWake(['answer', 'copy']);
                }),
                result: { newest: newest?.id ?? null, waiting: waiting?.state ?? null, older: older?.state ?? null },
              };
            }),
          },
          CONTROL_KEY,
        );
        expect(outcome).toEqual({ committed: { newest: 'newer', waiting: 'open', older: 'delivered' } });
        expect((yield* harness.inbox.openRequests(holder.id)).map((item) => item.id)).toEqual(['waiting']);
        expect(yield* states(harness, ['answer', 'copy'])).toEqual([
          ['queued', null],
          ['queued', null],
        ]);
        expect((yield* harness.inbox.pendingWakes(10)).map((item) => item.id).sort()).toEqual(['answer', 'copy']);
      }),
    );
    test(
      'a refused control writes nothing, and a control whose writes fail rolls every one of them back',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const requester = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const holder = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(task('owed', holder.id, requester.id, 1_000));
        expect(
          yield* harness.inbox.control<string>(holder.id, { decide: () => Effect.succeed({ refuse: 'changed' }) }, CONTROL_KEY),
        ).toEqual({ refused: 'changed' });
        const failed = yield* Effect.flip(
          harness.inbox.control<null>(
            holder.id,
            {
              decide: () =>
                Effect.succeed({
                  apply: Effect.fnUntraced(function* (writes) {
                    yield* writes.put(envelope('answer', requester.id, holder.id, 2_000));
                    yield* writes.closeRequests(['owed'], 'answer');
                    yield* writes.intendWake(['answer']);
                    return yield* new ThreadStorageFailed({ call: 'test', cause: new UnitFailed() });
                  }),
                  result: null,
                }),
            },
            CONTROL_KEY,
          ),
        );
        expect(failed).toMatchObject({ _tag: 'ThreadStorageFailed', call: 'test', cause: expect.any(UnitFailed) });
        expect((yield* harness.inbox.openRequests(holder.id)).map((item) => item.id)).toEqual(['owed']);
        expect(yield* harness.inbox.receipt('answer')).toBeUndefined();
        expect(yield* harness.inbox.pendingWakes(10)).toEqual([]);
      }),
    );
    test(
      'a keyed control replays its committed answer and writes nothing again; the key under another digest conflicts',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const holder = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const keyed = (digest: string) => ({
          ...CONTROL_KEY,
          key: { evidence: { call: { namespace: `send:${holder.id}`, id: 'k1' } }, digest },
        });
        const putting = (id: string, at: number) =>
          harness.inbox.control<string>(
            holder.id,
            {
              decide: () =>
                Effect.succeed({
                  apply: Effect.fnUntraced(function* (writes) {
                    yield* writes.put(envelope(id, recipient.id, holder.id, at));
                    yield* writes.intendWake([id]);
                  }),
                  result: id,
                }),
            },
            keyed(at === 3_000 ? 'other' : 'same'),
          );
        expect(yield* putting('first', 1_000)).toEqual({ committed: 'first' });
        expect(yield* putting('second', 2_000)).toEqual({ replayed: 'first' });
        expect(threadCauseOf(yield* Effect.flip(putting('third', 3_000)))).toBeInstanceOf(InboxConflict);
        expect((yield* harness.inbox.pending(recipient.id)).map((item) => item.id)).toEqual(['first']);
        expect((yield* harness.inbox.pendingWakes(10)).map((item) => item.id)).toEqual(['first']);
      }),
    );
    test(
      'deleting the thread takes its inbox with it',
      Effect.fnUntraced(function* () {
        const harness = yield* opened(open);
        const recipient = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.inbox.put(turn('words', recipient.id, 1_000));
        yield* harness.aggregate.delete([recipient.id]);
        expect(yield* harness.inbox.receipt('words')).toBeUndefined();
        expect(yield* harness.inbox.pending(recipient.id)).toEqual([]);
      }),
    );
  });
}
const opened = <TTx, TWrite extends TTx = TTx, R = never>(open: ThreadStorageFactory<TTx, TWrite, R>) =>
  Effect.acquireRelease(open(), (harness) => harness.dispose());
const states = <TTx, TWrite extends TTx = TTx>(harness: ThreadStorageHarness<TTx, TWrite>, ids: readonly string[]) =>
  Effect.map(
    Effect.forEach(ids, (id) => harness.inbox.receipt(id), { concurrency: 3 }),
    (items) => items.map((item) => (item ? ([item.state, item.deliveredToRunId] as const) : undefined)),
  );
function task(id: string, threadId: string, senderThreadId: string, at: number, text = `task ${id}`): ThreadInboxItemValues {
  return {
    id,
    threadId,
    sender: { kind: 'thread', threadId: senderThreadId, name: null },
    kind: 'task',
    body: { intent: 'task', text, inReplyTo: null },
    occurredAt: new Date(at).toISOString(),
  };
}
function interrupt(id: string, threadId: string, senderThreadId: string, at: number): ThreadInboxItemValues {
  return {
    id,
    threadId,
    sender: { kind: 'thread', threadId: senderThreadId, name: null },
    kind: 'task',
    body: { intent: 'interrupt', text: `reason ${id}`, inReplyTo: null },
    occurredAt: new Date(at).toISOString(),
  };
}
function hostTask(id: string, threadId: string, at: number): ThreadInboxItemValues {
  return {
    id,
    threadId,
    sender: { kind: 'host' },
    kind: 'task',
    body: { intent: 'task', text: `host task ${id}`, inReplyTo: null },
    occurredAt: new Date(at).toISOString(),
  };
}
function envelope(id: string, threadId: string, senderThreadId: string, at: number): ThreadInboxItemValues {
  return {
    id,
    threadId,
    sender: { kind: 'thread', threadId: senderThreadId, name: 'peer' },
    kind: 'envelope',
    body: { intent: 'message', text: `message ${id}`, inReplyTo: null },
    occurredAt: new Date(at).toISOString(),
  };
}
function turn(id: string, threadId: string, at: number): ThreadInboxItemValues {
  return {
    id,
    threadId,
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text: `turn ${id}`, attachments: [{ id: `attachment-${id}` }] },
    occurredAt: new Date(at).toISOString(),
  };
}
function signal(id: string, threadId: string, at: number): ThreadInboxItemValues {
  return {
    id,
    threadId,
    sender: { kind: 'host' },
    kind: 'signal',
    body: { type: 'widget-finished', addressee: 'transport', text: `signal ${id}` },
    occurredAt: new Date(at).toISOString(),
  };
}
