import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { describeThreadStorageRows } from '@runlith/agent/thread/conformance/storagePort';
import { fileThreadStorage, openFileThreadStorage } from '../fileStorage.js';

layer(fileThreadStorage, { excludeTestServices: true })('SQLite storage contracts', (it) => {
  describeThreadStorageRows('Tagma bun:sqlite', openFileThreadStorage, it.effect);

  it.effect('a run started on a gone thread, and a child born under a gone parent, fail as ThreadNotFound', () =>
    Effect.gen(function* () {
      const harness = yield* openFileThreadStorage();
      const thread = yield* harness.createThread({ ownerId: 'owner', scope: 'scope-a' });
      yield* harness.aggregate.delete([thread.id]);
      const started = harness.runs({ ownerId: 'instance', scope: 'scope-a' }).createRun({
        startFrom: {
          id: thread.id,
          ownerId: thread.ownerId,
          account: thread.account,
          provider: thread.provider,
          model: thread.model,
          reasoning: thread.reasoning,
          switches: {},
        },
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: 'starting', message: null },
      });
      expect(yield* Effect.flip(started)).toBeInstanceOf(ThreadNotFoundError);
      const born = harness.aggregate.transaction((tx) =>
        harness.aggregate.insertChild(thread.id, { ownerId: 'owner', agentId: 'agent' }, tx),
      );
      expect(yield* Effect.flip(born)).toBeInstanceOf(ThreadNotFoundError);
    }),
  );
});
