import { Effect } from 'effect';
import { inMemoryInboxStorage } from '../storage/InMemoryInboxStorage';
import { makeMemoryCompaction } from '../storage/memory/ThreadCompaction';
import { makeMemoryEvents } from '../storage/memory/ThreadEvents';
import { makeMemoryOwnerSettings } from '../storage/memory/OwnerSettings';
import { makeMemoryResources } from '../storage/memory/ThreadResources';
import { makeMemoryRows } from '../storage/memory/ThreadRows';
import { makeMemoryRuns } from '../storage/memory/ThreadRuns';
import { inMemoryThreadTransitions } from '../storage/memory/ThreadTransitions';
import { ThreadMemory } from '../storage/memory/state';
import { makeThreadEntryReader, type ThreadEntryReader } from '../../transcript/kinds';
import type { MemoryTx, MemoryUnits } from '../storage/memory/units';
import type { ThreadResourceLedgerHarness } from './resources';

export type MemoryStorage = ThreadResourceLedgerHarness<MemoryTx> & { readonly units: MemoryUnits };

export const openMemoryStorage = (kinds: ThreadEntryReader = makeThreadEntryReader({ products: [] })) =>
  Effect.sync(() => {
    const memory = new ThreadMemory(kinds);
    const inbox = inMemoryInboxStorage({ units: memory.units, calls: memory.records });
    memory.onRemoval((gone, tx) => inbox.forget(gone, tx));
    return memoryStorage(memory, inbox);
  });

function memoryStorage(memory: ThreadMemory, inbox: ReturnType<typeof inMemoryInboxStorage>): MemoryStorage {
  const aggregate = makeMemoryRows({ memory });
  return {
    aggregate,
    units: memory.units,
    compaction: makeMemoryCompaction({ memory }),
    inbox,
    eventLog: makeMemoryEvents({ memory }),
    transitions: inMemoryThreadTransitions({ memory }),
    ownerSettings: makeMemoryOwnerSettings({ memory }),
    kinds: memory.kinds,
    resources: makeMemoryResources({ memory }),
    runs: ({ ownerId, scope }) => makeMemoryRuns({ memory, ownerId, scope }),
    createThread: Effect.fnUntraced(function* ({ ownerId, scope, transport }) {
      const row = yield* aggregate.insert({ ownerId, agentId: 'tagma', transport });
      const held = memory.held(row.id);
      if (held) held.scope = scope;
      return row;
    }),
    reopen: () => Effect.sync(() => memoryStorage(memory, inbox)),
    dispose: () => Effect.void,
  };
}
