import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { memorySessionRows } from '../testing/memorySessions.js';
import { describeSessionStore } from '../testing/sessionConformance.js';
import { HarnessSessionStore } from './sessions.js';
import { terminalKernel } from '../birth/seat.js';

const fixture = Effect.fnUntraced(function* () {
  const storage = yield* openMemoryStorage();
  const kernel = terminalKernel('claude-code', undefined, false, {});
  const thread = yield* storage.createThread({ ownerId: 'owner', scope: 'scope-a', transport: kernel.transport });
  yield* storage.aggregate.update(thread.id, {
    capabilities: kernel.capabilities,
    provider: kernel.selection.provider,
    model: kernel.selection.model,
    reasoning: kernel.selection.reasoning,
    account: kernel.account,
    switches: kernel.switches,
  });
  const memory = yield* memorySessionRows(storage);
  yield* memory.seed(thread.id, harnessFacet('claude-code'));
  return { store: new HarnessSessionStore(memory.rows, () => Effect.void), rows: memory.rows, id: thread.id };
});

describeSessionStore('memory', fixture, it.effect);
