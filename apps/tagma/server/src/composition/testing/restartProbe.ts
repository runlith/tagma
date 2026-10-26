import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { makeRestartRig } from './restartRig.js';

export const restartProbe = Effect.gen(function* () {
  const rig = yield* makeRestartRig();
  yield* rig.prepare(1);
  const sample = yield* rig.sample(rig.place(0));
  assert.equal(sample.restored.projectId, sample.place.projectId);
  assert.equal(sample.restored.threadId, sample.place.threadId);
  assert.equal(sample.restored.draft, sample.place.draft);
  assert.notEqual(sample.buildAfter, sample.buildBefore);
  assert.notEqual(sample.record.successor?.pid, sample.record.predecessor?.pid);
  assert.equal(sample.record.windows[0]?.durationMs, sample.windowMs);
  assert.equal(sample.record.windows[0]?.threadId, sample.place.threadId);
  for (const point of ['accepted', 'door-closed', 'owners-closed', 'data-taken', 'stores-opened', 'host-checked', 'door-ready'])
    assert(
      sample.record.points.some((recorded) => recorded.name === point),
      point,
    );
  assert(
    sample.record.phases.some(
      (phase) => phase.name === 'runtime composed' && phase.outcome === 'completed' && phase.pid === sample.record.successor?.pid,
    ),
  );
  assert(
    sample.record.phases.some(
      (phase) => phase.name === 'thread stack closed' && phase.outcome === 'completed' && phase.pid === sample.record.predecessor?.pid,
    ),
  );
  assert(sample.rolloutReads.length > 0, 'the successor read no requested rollout');
  for (const path of sample.rolloutReads) assert(path.includes(sample.place.threadId), `unrequested rollout read: ${path}`);
  return sample;
});
