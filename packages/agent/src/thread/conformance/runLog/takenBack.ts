import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Fiber, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadSnapshot } from '../../state';
import type { ThreadStorageFactory } from '../storagePort';
import type { ThreadLiveEvent } from '../../run/ThreadLiveFeed';
import { OWNER, SCOPE, openedRun, pump, startedTurn, queuedTurn } from './world';
import { heldTurn, replyTurn, steeredTurn, hangingTurn, scriptedStep } from './scripts';
import { gate, inboxQueued, until, messageText } from './support';
import { coreEntry } from '../../../transcript/kinds';
export function describeThreadRunTakenBack<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — words taken back, attachments and deletion`, () => {
    test(
      'words taken back before their run ends open no turn at all',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const held = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working' },
            ],
            reached: held.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* held.reached;
        const waiting = yield* queuedTurn(world.harness.threads.handle(thread.id, OWNER), 'Never mind, drop this.');
        expect(yield* world.harness.threads.handle(thread.id, OWNER).unqueue(waiting.id)).toBe(true);
        expect(yield* inboxQueued(storage, thread.id, 'turn')).toHaveLength(0);
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(rowTranscript.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Never mind, drop this.')).toBe(
          false,
        );
      }),
    );
    test(
      'a steer taken back before its run reads it reaches no model at all',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const held = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working' },
            ],
            reached: held.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* held.reached;
        expect(
          yield* world.harness.threads.handle(thread.id, OWNER).steer({ expectedRunId: first.runId, text: 'Ignore that idea.' }),
        ).toMatchObject({ status: 'steered', runId: first.runId });
        const waiting = (yield* inboxQueued(storage, thread.id, 'signal'))[0];
        if (!waiting) return yield* Effect.die('The steer never reached the inbox.');
        expect(yield* world.harness.threads.handle(thread.id, OWNER).unqueue(waiting.id)).toBe(true);
        expect(yield* inboxQueued(storage, thread.id, 'signal')).toHaveLength(0);
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect((yield* runs.latestRun(thread.id))?.id).toBe(first.runId);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(
          rowTranscript.some(
            (entry) => coreEntry(entry) && (entry.type === 'signal' || entry.type === 'message') && entry.text === 'Ignore that idea.',
          ),
        ).toBe(false);
      }),
    );
    test(
      'a queued turn carries its attachments into the turn it opens',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const held = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working' },
            ],
            reached: held.reach,
          }),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* held.reached;
        const waiting = yield* queuedTurn(world.harness.threads.handle(thread.id, OWNER), 'Look at this one.', [{ id: 'shot-1' }]);
        expect(waiting.queued.attachments).toEqual([{ id: 'shot-1' }]);
        world.plan.push(
          replyTurn({
            chunks: [
              { type: 'text-start', id: 'f1' },
              { type: 'text-delta', id: 'f1', text: 'Saw it.' },
              { type: 'text-end', id: 'f1' },
            ],
            steps: [scriptedStep({ text: 'Saw it.', messages: [Message.assistant('Saw it.')] })],
          }),
        );
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
            (entries ?? []).some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Saw it.'),
          ),
        );
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        const userTurn = rowTranscript.findLast(
          (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user' && entry.text === 'Look at this one.',
        ) as
          | {
              attachments?: readonly {
                mime: string;
                url: string;
              }[];
            }
          | undefined;
        expect(userTurn?.attachments).toEqual([{ mime: 'image/png', url: 'test://shot-1' }]);
      }),
    );
    test(
      'a steer carries its attachment into the fact, the live row and the request built from it',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const held = gate();
        world.plan.push(steeredTurn({ reached: held.reach, released: held.released, onDrained: () => {} }));
        const signalRecords: unknown[] = [];
        const watching = yield* Effect.acquireRelease(
          Effect.sync(() =>
            world.harness.reads.subscribe(thread.id, (event: ThreadLiveEvent<ThreadSnapshot>) => {
              if (event.type !== 'state') return;
              for (const record of event.frame.deltas) if (record.entry?.type === 'signal') signalRecords.push(record.entry);
            }),
          ),
          (detach) => Effect.sync(detach),
        );
        const first = yield* startedTurn(world, thread.id, 'Start something long.');
        const pumping = yield* Effect.forkScoped(pump(first));
        yield* held.reached;
        expect(
          yield* world.harness.threads.handle(thread.id, OWNER).steer({
            expectedRunId: first.runId,
            text: 'Look at this one.',
            attachments: [{ id: 'shot-2' }],
          }),
        ).toMatchObject({ status: 'steered', runId: first.runId });
        const waiting = yield* world.harness.reads.snapshot(thread.id);
        held.release();
        yield* Fiber.join(pumping);
        expect(waiting.pendingInput.steers).toMatchObject([
          { runId: first.runId, text: 'Look at this one.', attachments: [{ id: 'shot-2' }] },
        ]);
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
            (entries ?? []).some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        const said = rowTranscript.findLast((entry) => entry.type === 'signal') as
          | {
              text?: string;
              attachments?: readonly {
                mime: string;
                url: string;
              }[];
            }
          | undefined;
        expect(said?.text).toBe('Look at this one.');
        expect(said?.attachments).toEqual([{ mime: 'image/png', url: 'test://shot-2' }]);
        watching();
        expect(signalRecords).toEqual([
          expect.objectContaining({ text: 'Look at this one.', attachments: [{ mime: 'image/png', url: 'test://shot-2' }] }),
        ]);
        world.plan.push(
          replyTurn({
            chunks: [
              { type: 'text-start', id: 'f1' },
              { type: 'text-delta', id: 'f1', text: 'Seen.' },
              { type: 'text-end', id: 'f1' },
            ],
            steps: [scriptedStep({ text: 'Seen.', messages: [Message.assistant('Seen.')] })],
          }),
        );
        const opened = world.replayed.length;
        const second = yield* startedTurn(world, thread.id, 'And now?');
        yield* until(() => Effect.sync(() => world.replayed.length > opened));
        yield* pump(second);
        const replay = world.replayed.at(-1) ?? [];
        const carried = replay.findLast((message) => message.role === 'user' && messageText(message).includes('Look at this one.'));
        expect(carried?.content.map((part) => part.type)).toEqual(['text', 'media']);
        expect(carried?.content.find((part) => part.type === 'media')).toMatchObject({ mediaType: 'image/png', data: 'test://shot-2' });
      }),
    );
    test(
      'deleting a thread with words waiting takes them with it',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const held = gate();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working' },
            ],
            reached: held.reach,
          }),
        );
        yield* startedTurn(world, thread.id, 'Start something long.');
        yield* held.reached;
        yield* queuedTurn(world.harness.threads.handle(thread.id, OWNER), 'And then this.');
        expect(yield* world.harness.threads.handle(thread.id, OWNER).delete()).toBe(true);
        expect(yield* storage.aggregate.find(thread.id)).toBeUndefined();
      }),
    );
    test(
      'stopping a run unwinds the fiber that held it, and a second stop finds nothing',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const held = gate();
        world.plan.push(heldTurn(held.released));
        const stream = yield* startedTurn(world, thread.id, 'Hold the thread open.');
        const drain = yield* Effect.forkScoped(pump(stream));
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
            (entries ?? []).some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Held.'),
          ),
        );
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        held.release();
        yield* Fiber.join(drain);
        expect(yield* world.harness.threads.handle(thread.id, OWNER).stop()).toEqual({ status: 'nothing-running' });
        const row = yield* storage.aggregate.find(thread.id);
        const rowTranscript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(row?.status).toBe('idle');
        expect(rowTranscript.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Held.')).toBe(true);
        expect(row?.history.some((message) => messageText(message) === 'Held.')).toBe(true);
      }),
    );
  });
}
