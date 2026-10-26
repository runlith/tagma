import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Data, Effect, type Scope } from 'effect';
import { ThreadStorageFailed } from '../../persisted';
import { decodeThreadEventPayload } from '../../events';
import { threadEntryIdentity } from '../../ThreadQuery';
import type { ThreadStorageFactory } from '../storagePort';
import { INSTANCE, OWNER, SCOPE, appendEvent, folding, settlePatch, started, startInput } from './support';
class ProjectionRefused extends Data.TaggedError('ProjectionRefused')<Record<string, never>> {}
export function describeThreadEventLogPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: thread event log port`, () => {
    test(
      'event positions are storage-assigned, strictly increasing and gapless under concurrent appends',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const appended = yield* Effect.forEach(
          [0, 1],
          (index) => appendEvent(harness, { threadId: thread.id, id: `event-${index}`, kind: 'probe', payload: { index } }),
          { concurrency: 2 },
        );
        const positions = appended.map((row) => row.position).sort((a, b) => a - b);
        expect(positions).toEqual([1, 2]);
      }),
    );
    test(
      'replay is ordered and strictly after the position it resumes from',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        for (const id of ['a', 'b', 'c']) yield* appendEvent(harness, { threadId: thread.id, id, kind: 'probe', payload: {} });
        const whole = yield* harness.eventLog.eventsAfter(thread.id, 0, 100);
        expect(whole.map((row) => row.id)).toEqual(['a', 'b', 'c']);
        const resumed = yield* harness.eventLog.eventsAfter(thread.id, 1, 100);
        expect(resumed.map((row) => row.id)).toEqual(['b', 'c']);
      }),
    );
    test(
      'a record id resolves its exact row and an entry id resolves its latest revision',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const opening = yield* appendEvent(harness, {
          threadId: thread.id,
          id: 'event-opened',
          kind: 'tool',
          payload: { entry: { type: 'tool', id: 'tool:call', toolState: 'input-available' } },
        });
        const settled = yield* appendEvent(harness, {
          threadId: thread.id,
          id: 'event-settled',
          kind: 'tool',
          payload: { entry: { type: 'tool', id: 'tool:call', toolName: 'read', toolCallId: 'call', toolState: 'output-error' } },
        });
        yield* appendEvent(harness, {
          threadId: thread.id,
          id: 'event-collision',
          kind: 'message',
          payload: { entry: { type: 'message', id: opening.id, role: 'assistant', text: 'collides' } },
        });
        expect(yield* harness.eventLog.positionOf(thread.id, opening.id)).toBe(opening.position);
        expect(yield* harness.eventLog.positionOf(thread.id, 'tool:call')).toBe(settled.position);
        expect(yield* harness.eventLog.positionOf(thread.id, 'missing')).toBeNull();
      }),
    );
    test(
      'a tool call resolves by the identity a revision reading prints',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const call = (state: string, id: string) => ({
          threadId: thread.id,
          id,
          kind: 'tool',
          payload: { entry: { type: 'tool', id: 'tool:one', runId: 'run-1', toolName: 'read', toolCallId: 'one', toolState: state } },
        });
        yield* appendEvent(harness, call('input-available', 'call-opened'));
        const settled = yield* appendEvent(harness, call('output-available', 'call-settled'));
        const revisions = yield* harness.eventLog.revisionsAsOf(thread.id, { head: settled.position, afterPosition: 0, limit: 100 });
        expect(revisions.map((row) => row.identity)).toEqual(['tool:run-1:one']);
        expect(yield* harness.eventLog.positionOf(thread.id, 'tool:run-1:one')).toBe(settled.position);
        expect(yield* harness.eventLog.positionOf(thread.id, 'tool:one')).toBe(settled.position);
        expect(yield* harness.eventLog.positionOf(thread.id, settled.id)).toBe(settled.position);
        expect(yield* harness.eventLog.positionOf(thread.id, 'tool:run-2:one')).toBeNull();
      }),
    );
    test(
      'a reading bounded by a pinned head answers the latest revision of each logical identity',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const call = (state: string, id: string) => ({
          threadId: thread.id,
          id,
          kind: 'tool',
          payload: { entry: { type: 'tool', id: 'tool:one', runId: 'run-1', toolName: 'read', toolCallId: 'one', toolState: state } },
        });
        const opening = yield* appendEvent(harness, call('input-available', 'call-opened'));
        const message = yield* appendEvent(harness, {
          threadId: thread.id,
          id: 'said',
          kind: 'message',
          payload: { entry: { type: 'message', id: 'message-1', runId: 'run-1', role: 'user', text: 'go' } },
        });
        const settled = yield* appendEvent(harness, call('output-available', 'call-settled'));
        const early = yield* harness.eventLog.revisionsAsOf(thread.id, { head: message.position, afterPosition: 0, limit: 100 });
        expect(early.map((row) => row.id)).toEqual([opening.id, message.id]);
        const whole = yield* harness.eventLog.revisionsAsOf(thread.id, { head: settled.position, afterPosition: 0, limit: 100 });
        expect(whole.map((row) => row.id)).toEqual([message.id, settled.id]);
        expect(whole.map((row) => row.identity)).toEqual(['message-1', 'tool:run-1:one']);
        expect(whole.map((row) => threadEntryIdentity(decodeThreadEventPayload(harness.kinds, row.payload)))).toEqual([
          'message-1',
          'tool:run-1:one',
        ]);
        const raw = yield* harness.eventLog.recordsAsOf(thread.id, { head: settled.position, afterPosition: 0, limit: 100 });
        expect(raw.map((row) => row.id)).toEqual([opening.id, message.id, settled.id]);
        const tools = yield* harness.eventLog.recordsAsOf(thread.id, {
          head: settled.position,
          afterPosition: 0,
          limit: 100,
          kinds: ['tool'],
        });
        expect(tools.map((row) => row.id)).toEqual([opening.id, settled.id]);
      }),
    );
    test(
      'a withdrawal leaves the revision it names standing as evidence',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const said = yield* appendEvent(harness, {
          threadId: thread.id,
          id: 'said',
          kind: 'message',
          payload: { entry: { type: 'message', id: 'message-1', runId: 'run-1', role: 'user', text: 'go' } },
        });
        const taken = yield* appendEvent(harness, {
          threadId: thread.id,
          id: 'taken-back',
          kind: 'withdrawal',
          payload: { withdrawn: { runId: 'run-1', keepMessages: 0 } },
        });
        const revisions = yield* harness.eventLog.revisionsAsOf(thread.id, { head: taken.position, afterPosition: 0, limit: 100 });
        expect(revisions.map((row) => row.id)).toEqual([said.id]);
        const raw = yield* harness.eventLog.recordsAsOf(thread.id, { head: taken.position, afterPosition: 0, limit: 100 });
        expect(raw.map((row) => row.id)).toEqual([said.id, taken.id]);
      }),
    );
    test(
      'an append and its projectors land or roll back as one unit, the run-row fold included',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        expect(
          yield* Effect.flip(
            harness.aggregate.transaction(
              Effect.fnUntraced(function* (tx) {
                yield* harness.eventLog.append({ threadId: thread.id, id: 'doomed', kind: 'probe', payload: {} }, tx);
                yield* harness.aggregate.update(thread.id, { model: 'projected' }, tx);
                yield* runs.settleRun(run.id, yield* settlePatch('completed'), tx);
                return yield* new ProjectionRefused({});
              }),
            ),
          ),
        ).toBeInstanceOf(ProjectionRefused);
        expect(yield* harness.eventLog.eventsAfter(thread.id, 0, 100)).toHaveLength(0);
        expect((yield* harness.aggregate.find(thread.id))?.model).not.toBe('projected');
        expect((yield* runs.latestRun(thread.id, ['running']))?.id).toBe(run.id);
        const next = yield* appendEvent(harness, { threadId: thread.id, id: 'survivor', kind: 'probe', payload: {} });
        expect(next.position).toBe(1);
        yield* harness.aggregate.transaction(
          Effect.fnUntraced(function* (tx) {
            yield* harness.eventLog.append({ threadId: thread.id, id: 'settled', kind: 'probe', payload: {} }, tx);
            yield* runs.settleRun(run.id, yield* settlePatch('completed'), tx);
          }),
        );
        expect((yield* runs.latestRun(thread.id))?.status).toBe('completed');
        expect((yield* harness.eventLog.eventsAfter(thread.id, 1, 100)).map((row) => row.id)).toEqual(['settled']);
      }),
    );
    test(
      'an append composes after the thread hold in one unit — the blessed order lands',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const appended = yield* harness.aggregate.transaction((tx) =>
          harness.transitions.writeAtIn(
            thread.id,
            ({ row, tx: unit }) => harness.eventLog.append({ threadId: row.id, id: 'after-lifecycle', kind: 'probe', payload: {} }, unit),
            tx,
          ),
        );
        expect(appended?.position).toBe(1);
      }),
    );
    test(
      'an append rides a held unit: the fold and the event land or roll back together',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* folding(
          harness,
          thread.id,
          Effect.fnUntraced(function* ({ tx }) {
            yield* harness.eventLog.append({ threadId: thread.id, id: 'folded', kind: 'probe', payload: {} }, tx);
            return { placements: [{ kind: 'append', entry: { type: 'message', id: 'folded', role: 'assistant', text: 'folded' } }] };
          }),
        );
        expect((yield* harness.eventLog.eventsAfter(thread.id, 0, 100)).map((row) => row.id)).toEqual(['folded']);
        expect((yield* harness.aggregate.transcriptOf(thread.id))?.some((entry) => entry.id === 'folded')).toBe(true);
        expect(
          yield* Effect.flip(
            folding(
              harness,
              thread.id,
              Effect.fnUntraced(function* ({ tx }) {
                yield* harness.eventLog.append({ threadId: thread.id, id: 'doomed-fold', kind: 'probe', payload: {} }, tx);
                return yield* new ProjectionRefused({});
              }),
            ),
          ),
        ).toBeInstanceOf(ProjectionRefused);
        expect((yield* harness.eventLog.eventsAfter(thread.id, 0, 100)).map((row) => row.id)).toEqual(['folded']);
      }),
    );
    test(
      'kind and payload round-trip the engine byte-honestly',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const payload = {
          entry: { type: 'signal', id: 'transcript:signal:s-1', signalType: 'user-message', text: 'check the build' },
          messages: [{ role: 'user', content: [{ type: 'text', text: 'check the build' }] }],
        };
        yield* appendEvent(harness, { threadId: thread.id, id: 'round', kind: 'signal', payload });
        const [read] = yield* harness.eventLog.eventsAfter(thread.id, 0, 1);
        expect(read?.kind).toBe('signal');
        expect(read?.payload).toEqual(payload);
      }),
    );
    test(
      'the read is windowed, and the head answers without materializing the log',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        expect(yield* harness.eventLog.headPosition(thread.id)).toBe(0);
        for (const id of ['w1', 'w2', 'w3', 'w4', 'w5'])
          yield* appendEvent(harness, { threadId: thread.id, id, kind: 'probe', payload: {} });
        expect((yield* harness.eventLog.eventsAfter(thread.id, 0, 2)).map((row) => row.position)).toEqual([1, 2]);
        expect((yield* harness.eventLog.eventsAfter(thread.id, 2, 2)).map((row) => row.position)).toEqual([3, 4]);
        expect(yield* harness.eventLog.headPosition(thread.id)).toBe(5);
      }),
    );
    test(
      'an event id is minted once: a second append of another fact under the same id is refused',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* appendEvent(harness, { threadId: thread.id, id: 'once', kind: 'probe', payload: {} });
        expect(
          yield* Effect.flip(appendEvent(harness, { threadId: thread.id, id: 'once', kind: 'probe', payload: { other: true } })),
        ).toBeInstanceOf(ThreadStorageFailed);
      }),
    );
    test(
      'event identity is global: the same id is refused even in another thread`s log',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const first = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const second = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* appendEvent(harness, { threadId: first.id, id: 'global-once', kind: 'probe', payload: {} });
        expect(
          yield* Effect.flip(appendEvent(harness, { threadId: second.id, id: 'global-once', kind: 'probe', payload: {} })),
        ).toBeInstanceOf(ThreadStorageFailed);
      }),
    );
    test(
      'two threads have independent logs, and deletion takes the log with the row',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const first = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const second = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* appendEvent(harness, { threadId: first.id, id: 'first-1', kind: 'probe', payload: {} });
        const other = yield* appendEvent(harness, { threadId: second.id, id: 'second-1', kind: 'probe', payload: {} });
        expect(other.position).toBe(1);
        expect((yield* harness.eventLog.eventsAfter(second.id, 0, 100)).map((row) => row.id)).toEqual(['second-1']);
        yield* harness.aggregate.delete([first.id]);
        expect(yield* harness.eventLog.eventsAfter(first.id, 0, 100)).toHaveLength(0);
        expect((yield* harness.eventLog.eventsAfter(second.id, 0, 100)).map((row) => row.id)).toEqual(['second-1']);
      }),
    );
  });
}
