import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import {
  ENDING_BEHAVIOR,
  endingSignal,
  type EndingCase,
  type EndingRig,
  type WordState,
} from '@runlith/agent/thread/conformance/transportWords';
import type { RigAgent } from './protocolAgents.js';
import type { ProtocolRig } from './protocolRig.js';
import { CLAUDE, rigReads, staged, staging } from './protocolStopRig.js';

export const protocolWordRig = (rig: ProtocolRig['Service'], agent: RigAgent, label = 'words'): EndingRig => {
  const { rested, prompted } = rigReads(rig, agent);
  const reach = Effect.fnUntraced(function* (state: WordState) {
    const report = staging(rig, `${label}-${state}`);
    yield* agent.install(report);
    const threadId = `thread-${label}-${state}`;
    yield* rig.openThread(threadId, CLAUDE);
    const resting = new Set<string>();
    const raised = yield* rig.floor([], { fails: 0, refuses: false, resting });
    const driver = yield* raised.driver(`owner-${label}-${state}`);
    const handle = raised.harness.threads.handle(threadId, 'operator');
    const hold = join(dirname(report), 'opening.hold');
    const release = () => writeFileSync(`${report}.release`, 'release');
    const step = () => writeFileSync(`${report}.step`, 'step');
    const archive = Effect.andThen(
      Effect.sync(() => resting.add(threadId)),
      Effect.andThen(handle.stop(), driver.stop(threadId)),
    );
    const wordCase = (during: EndingCase['during'], woken: Effect.Effect<unknown, unknown> = Effect.void): EndingCase => ({
      send: (text) => Effect.suspend(() => raised.harness.threads.handle(threadId, 'operator').send(text)),
      end: (id, text) =>
        Effect.suspend(() => raised.harness.threads.handle(threadId, 'operator').sendSignal(endingSignal(id, text), ENDING_BEHAVIOR)),
      during,
      settle: Effect.fnUntraced(function* () {
        step();
        rmSync(hold, { force: true });
        resting.delete(threadId);
        yield* woken;
        yield* rested(raised, threadId, report);
      }),
      heard: () => agent.heard(report),
    });
    if (state === 'starting') return wordCase((press) => press);
    if (state === 'reopening') {
      yield* driver.send(threadId, 'plain words');
      yield* rested(raised, threadId, report);
      yield* driver.stop(threadId);
      writeFileSync(hold, 'hold');
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(hold, { force: true })));
      return wordCase((press) => press);
    }
    yield* driver.send(threadId, 'HOLD the turn');
    yield* prompted(report, 1);
    switch (state) {
      case 'running':
        return wordCase((press) => press);
      case 'ending':
        return wordCase((press) => Effect.asVoid(Effect.all([Effect.sync(release), press], { concurrency: 'unbounded' })));
      case 'stopping':
        return wordCase((press) => Effect.asVoid(Effect.all([handle.stop(), press], { concurrency: 'unbounded' })));
      case 'archived':
        return wordCase(
          (press) => Effect.asVoid(Effect.all([archive, press], { concurrency: 'unbounded' })),
          Effect.suspend(() => raised.harness.threads.handle(threadId, 'operator').send('CHARLIE wakes the thread')),
        );
    }
  });
  return { reach: (state) => staged(reach(state)) };
};
