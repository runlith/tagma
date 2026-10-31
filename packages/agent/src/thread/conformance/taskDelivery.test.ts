import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { hold, opened, OWNER, quiet, SCOPE, transcriptOf } from './compactionWorld';
import { planned, sendTaskCall, spawnedChild } from './compactionRequests/support';
import { openMemoryStorage } from './memoryStorage';

it.live('an accepted task keeps its text and one obligation through withdrawn stops and continuation until its final report', () =>
  Effect.gen(function* () {
    const stack = yield* opened(openMemoryStorage, { collaboration: true });
    const { world, storage, threadId } = stack;
    const childId = yield* spawnedChild(
      stack,
      { call: 'send_message', input: { to: [threadId], message: 'First job done.', final: true } },
      { text: 'First job done.' },
      { text: 'First report read.' },
    );
    yield* quiet(world, childId);
    yield* quiet(world, threadId);
    const brief = 'Build the index for TASK-17 with the accepted file list.';
    const first = hold();
    planned(stack, childId, { parks: first });
    const sent = yield* sendTaskCall(stack, { to: [childId], task: brief }, { text: 'Final report read.' });
    expect(sent.toolError).toBeUndefined();
    yield* first.reached;
    const [request] = yield* storage.inbox.openRequests(childId);
    expect(request).toMatchObject({ body: { text: brief }, sender: { kind: 'thread', threadId } });
    const child = world.harness.threads.handle(childId, OWNER);
    const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const active = yield* runs.latestRun(childId);
      expect(yield* child.stop(undefined, { withdraw: true })).toMatchObject({ status: 'stopped', runId: active!.id });
      yield* quiet(world, childId);
      expect(JSON.stringify((yield* storage.aggregate.find(childId))!.history)).toContain(brief);
      expect(yield* storage.inbox.openRequests(childId)).toMatchObject([
        { id: request!.id, deliveredToRunId: active!.id, body: { text: brief } },
      ]);
      const continued = hold();
      planned(stack, childId, { parks: continued });
      yield* child.continue();
      yield* continued.reached;
      const heard = JSON.stringify(world.heard.get(childId)!.at(-1));
      expect(heard.split(brief)).toHaveLength(2);
      expect(heard).toContain(request!.id);
    }
    expect(yield* child.stop()).toMatchObject({ status: 'stopped' });
    yield* quiet(world, childId);
    planned(
      stack,
      childId,
      { call: 'send_message', input: { to: [threadId], message: 'The index is built.', final: true } },
      { text: 'Reported.' },
    );
    yield* child.continue();
    yield* quiet(world, childId);
    yield* quiet(world, threadId);
    expect(yield* storage.inbox.openRequests(childId)).toEqual([]);
    const taskEntries = (yield* transcriptOf(storage, childId)).filter(
      (entry) => entry.type === 'signal' && 'text' in entry && entry.text === brief,
    );
    expect(taskEntries).toHaveLength(1);
    expect(
      (yield* transcriptOf(storage, threadId)).filter(
        (entry) => entry.type === 'signal' && 'text' in entry && entry.text === 'The index is built.',
      ),
    ).toHaveLength(1);
  }),
);
