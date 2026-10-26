import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { makeDoorWorld } from '../doorFixture.js';

it.live("a defect in the operator's call over HTTP is listed once, with the thread it addresses and that thread's project", () =>
  Effect.gen(function* () {
    let broken = false;
    const world = yield* makeDoorWorld({
      models: (standing) => ({
        ...standing,
        served: (...asked) => (broken ? Effect.die('the served window broke') : standing.served(...asked)),
      }),
    });
    const projectId = yield* world.stealthProject();
    const created = yield* world.op('create_thread', {}, `project=${projectId}`);
    const threadId = (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;

    broken = true;
    const failed = yield* world.op('read_compaction_choices', { threadId }, `project=${projectId}`);
    broken = false;
    expect(failed.status).toBe(500);

    const listed = yield* world.op('read_faults', {});
    const faults = (listed.body as { faults: readonly { message: string }[] }).faults.filter(
      (fault) => fault.message === 'the served window broke',
    );
    expect(faults).toMatchObject([{ place: 'read_compaction_choices', count: 1, thread: threadId, project: projectId }]);
  }),
);
