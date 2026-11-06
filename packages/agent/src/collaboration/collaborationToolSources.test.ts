import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import type { ThreadRow, ThreadRunRow } from '../thread/rows';
import type { ThreadRecord } from '../thread/record';
import { collaborationSource } from './collaborationToolSources';
import { COLLABORATION_TOOL_NAMES } from './CollaborationTools';
import type { ThreadPlaneAccess } from './ThreadPlaneAccess';
import { ThreadPlanes } from './ThreadPlanes';
import { Threads } from './threads';
const unused = () => Effect.die('This source does not perform a collaboration act.');
const run = { id: 'run-1', threadId: 'root' } as ThreadRunRow;
const root = { id: 'root', ownerId: 'owner-1', parentThreadId: null } as ThreadRow;
const threads = Threads.of({
  find: (id) => Effect.succeed(id === root.id ? ({ id, principal: root.ownerId } as ThreadRecord) : null),
  named: unused,
  deleted: unused,
  lineage: unused,
  list: unused,
  watch: unused,
  birthReceipt: unused,
  readBirth: unused,
  create: unused,
});
const treeOver = (access: ThreadPlaneAccess | null) =>
  ThreadPlanes.of({
    access: () => Effect.succeed(access),
    verbs: () => null,
  });
const plane = (): ThreadPlaneAccess => ({
  ownerId: 'owner-1',
  spawnDepth: { current: 0, maximum: 2, remaining: 2 },
  startable: [{ id: 'tagma', name: 'Tagma', description: 'The Tagma agent.', baseAgentId: 'tagma' }],
  summarizerChoice: true,
  worktrees: null,
  models: modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS),
  parent: null,
  spawnSettlement: () => Effect.succeed({ status: 'aborted' as const }),
  acting: unused,
});
describe('collaborationSource', () => {
  it.effect(
    'a mounted plane offers exactly its declared collaboration tools',
    Effect.fnUntraced(function* () {
      const source = yield* collaborationSource(treeOver(plane()), threads, { thread: root, run, context: null });
      expect(source!.id).toBe('collaboration');
      expect(Object.keys(source!.tools).sort()).toEqual([...COLLABORATION_TOOL_NAMES].sort());
    }),
  );
  it.effect(
    'a host without collaboration contributes no source',
    Effect.fnUntraced(function* () {
      expect(yield* collaborationSource(treeOver(null), threads, { thread: root, run, context: null })).toBeNull();
    }),
  );
});
