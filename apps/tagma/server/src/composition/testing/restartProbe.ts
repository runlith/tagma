import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { WIRE_PAGE_MAX_ENTRIES } from '@runlith/agent/protocol/cap';
import { makeRestartRig, type RestartSample } from './restartRig.js';
import { TRANSCRIPT_FOOTER_BYTES, TRANSCRIPT_SLOT_BYTES } from '../../native-harness/transcript/restedWork.js';

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

export const restartProbe = Effect.gen(function* () {
  const rig = yield* makeRestartRig();
  const messages = 4 * WIRE_PAGE_MAX_ENTRIES + 2;
  yield* rig.prepare(messages, true);
  const sample = yield* rig.sample(rig.place(0), { step: true });
  const frameBytes = sample.frameReads.reduce((sum, read) => sum + read.bytes, 0);
  const transcriptBytes = sample.frameReads.filter((read) => read.path.endsWith('.entries')).reduce((sum, read) => sum + read.bytes, 0);
  const compressedBytes = sample.frameReads.filter((read) => read.path.endsWith('.zst')).reduce((sum, read) => sum + read.bytes, 0);
  const frameBudget = sample.dataset.windowBytes + TRANSCRIPT_FOOTER_BYTES + sample.dataset.windowEntries * TRANSCRIPT_SLOT_BYTES;
  yield* Effect.logInfo('restart work', {
    messages: messages + sample.dataset.threads - 1,
    projects: sample.dataset.projects,
    threads: sample.dataset.threads,
    frameEntries: sample.transcript.length,
    transcriptBytes: sample.dataset.transcriptBytes,
    reads: sample.frameReads.length,
    frameBytes,
    frameBudget,
    bytesByKind: { transcript: transcriptBytes, compressed: compressedBytes, journal: frameBytes - transcriptBytes - compressedBytes },
  });
  assert.equal(sample.transcript.length, WIRE_PAGE_MAX_ENTRIES);
  assert.equal(sample.before, messages - WIRE_PAGE_MAX_ENTRIES);
  assert.equal(sample.transcript[0]?.id, `${sample.place.threadId}:message:${messages - WIRE_PAGE_MAX_ENTRIES}`);
  assert.equal(sample.transcript.at(-1)?.id, `${sample.place.threadId}:message:${messages - 1}`);
  const times = messageTimes(sample);
  assert.equal(times.length, WIRE_PAGE_MAX_ENTRIES);
  assert(
    times.every((time) => !time.endsWith('.000Z')),
    'the first frame of a lagging thread was not in the current shape',
  );
  assert(transcriptBytes > 0, 'the successor read no persisted transcript page');
  assert(frameBytes <= frameBudget, `the first frame read ${frameBytes} rollout bytes for a ${frameBudget}-byte window budget`);
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
  for (const read of sample.rolloutReads) assert(read.path.includes(sample.place.threadId), `unrequested rollout read: ${read.path}`);
  return sample;
});
