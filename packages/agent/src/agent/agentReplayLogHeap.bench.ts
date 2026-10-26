import { gcAndSweep, heapStats } from 'bun:jsc';
import { LLMEvent } from '@runlith/llm/schema/events';
import { Effect } from 'effect';
import type { AgentEvent } from './AgentEvent';
import { type Recording, recording } from './testing/recording';

type Snapshot = {
  readonly heapUsed: number;
  readonly heapObjects: number;
};

const mode = Bun.argv.includes('--shared') ? 'shared-entry' : 'real-entry';
const countArgument = Bun.argv.find((argument) => argument.startsWith('--count='));
const count = countArgument ? Number.parseInt(countArgument.slice('--count='.length), 10) : 250_000;

if (!Number.isSafeInteger(count) || count <= 0) {
  throw new Error(`--count must be a positive safe integer, received ${countArgument ?? 'nothing'}`);
}

warmUp();
gcAndSweep();
gcAndSweep();

let log: Recording<AgentEvent> | undefined = recording();
const shared = textDelta(0);
gcAndSweep();
const before = snapshot();

for (let index = 0; index < count; index += 1) {
  Effect.runSync(log.push(mode === 'shared-entry' ? shared : textDelta(index)));
}

gcAndSweep();
gcAndSweep();
const after = snapshot();
const retainedEntries = log.entries().length;
const retainedBytes = after.heapUsed - before.heapUsed;
const retainedObjects = after.heapObjects - before.heapObjects;

log = undefined;
gcAndSweep();
gcAndSweep();
const released = snapshot();

console.log(
  JSON.stringify(
    {
      mode,
      count,
      retainedEntries,
      before,
      after,
      retainedBytes,
      retainedObjects,
      bytesPerPush: retainedBytes / count,
      objectsPerPush: retainedObjects / count,
      released,
      bytesAfterRelease: released.heapUsed - before.heapUsed,
      objectsAfterRelease: released.heapObjects - before.heapObjects,
    },
    null,
    2,
  ),
);

function textDelta(index: number): AgentEvent {
  return LLMEvent.textDelta({
    id: 'text-1',
    text: `token ${index} of the answer, `,
  });
}

function warmUp(): void {
  const warm = recording<AgentEvent>();
  for (let index = 0; index < 10_000; index += 1) {
    Effect.runSync(warm.push(textDelta(index)));
  }
}

function snapshot(): Snapshot {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapObjects: heapStats().objectCount,
  };
}
