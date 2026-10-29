import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { makeRestartRig, type RestartSample } from './restartRig.js';

export const LAG_LENGTHS = { small: 50, big: 20_000 } as const;
export const LAG_TOLERANCE = { ratio: 1.5, slackMs: 3_000 } as const;

export const standInRestartedPlace = (messages: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const rig = yield* makeRestartRig();
      yield* rig.prepare(messages, true);
      return yield* rig.sample(rig.place(0), { step: true });
    }),
  );

const messageTimes = (sample: RestartSample) =>
  sample.transcript.flatMap((entry) => (entry.type === 'message' && entry.occurredAt !== undefined ? [entry.occurredAt] : []));

export const lagProbe = Effect.gen(function* () {
  const small = yield* standInRestartedPlace(LAG_LENGTHS.small);
  const big = yield* standInRestartedPlace(LAG_LENGTHS.big);
  for (const sample of [small, big]) {
    const times = messageTimes(sample);
    assert(times.length > 0, 'the first frame carried no message');
    assert(
      times.every((time) => !time.endsWith('.000Z')),
      'the first frame of a lagging thread was not in the current shape',
    );
  }
  assert(
    big.acceptedMs <= small.acceptedMs * LAG_TOLERANCE.ratio + LAG_TOLERANCE.slackMs,
    `the window in the big thread (${big.acceptedMs} ms) outgrew the window in the small thread (${small.acceptedMs} ms)`,
  );
  return { small, big };
});

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
