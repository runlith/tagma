import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { COMPACT } from '@runlith/hosted-runner/wire/extensions';
import { ProtocolRig, heard, protocolFixture, scenario, until } from './protocolRig.js';

layer(protocolFixture('profile-compaction'), { excludeTestServices: true })('hosted compaction negotiation', (it) => {
  it.effect('OpenCode negotiates and executes its own-model compaction through the driver', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'opencode-compaction-profile';
      const report = join(rig.stage, 'opencode-compact.report');
      yield* rig.agentBinary(report, 'tagma', 'opencode');
      yield* rig.openThread(threadId, { name: 'opencode', hosts: 'tagma' });
      yield* scenario(
        Effect.gen(function* () {
          const raised = yield* rig.floor([]);
          const driver = yield* raised.driver('opencode-compaction-owner');
          yield* driver.start(threadId);
          const asked = yield* raised.harness.threads.handle(threadId, 'operator').compact({ at: 'end' });
          if (asked.status !== 'started') return yield* Effect.die(`The idle request answered ${asked.status}.`);
          const boundary = yield* until(
            Effect.map(
              raised.entries(threadId),
              (entries) =>
                entries.findLast((entry) => entry.type === 'compaction' && entry.runId === asked.runId && entry.status !== 'running') ??
                null,
            ),
            'the negotiated compaction ended',
            report,
            rig.changes(threadId),
          );
          expect(boundary).toMatchObject({ type: 'compaction', status: 'completed', summary: 'the compacted summary' });
          expect((yield* heard(report)).filter((line) => line.method === COMPACT)).toHaveLength(1);
          yield* driver.stop(threadId);
        }),
      );
    }),
  );
});
