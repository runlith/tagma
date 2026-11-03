import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ThreadRecord } from '../thread/record';
import { ThreadCallBroke } from '../thread/ThreadBorder';
import { DeclaredCollaboration, SUB_AGENT_DEPTH } from './CollaborationConfig';
import { ThreadSpawnAccess, threadSpawnAccessLayer } from './ThreadSpawnAccess';
import { Threads } from './threads';
const record = (id: string, parentThreadId: string | null): ThreadRecord =>
  ({ id, principal: 'owner', parentThreadId, spawnRootId: 'root' }) as ThreadRecord;
const unused = () => Effect.die('Depth only reads the lineage.');
const accessOver = Effect.fnUntraced(function* (ancestors: ReadonlyMap<string, readonly ThreadRecord[]>) {
  const threads = Threads.of({
    lineage: (threadId) => Effect.succeed({ ancestors: ancestors.get(threadId) ?? [], complete: ancestors.has(threadId) }),
    find: unused,
    named: unused,
    list: unused,
    watch: unused,
    birthReceipt: unused,
    readBirth: unused,
    create: unused,
  });
  const declared = Layer.succeed(DeclaredCollaboration, {
    models: () => modelCatalog([]),
    subAgentDepth: () => Effect.succeed(SUB_AGENT_DEPTH.default),
    delegation: unused,
    reconcileIntervalMs: 1_000,
  });
  const layer = threadSpawnAccessLayer.pipe(Layer.provide(Layer.merge(Layer.succeed(Threads, threads), declared)));
  return Context.get(yield* Layer.build(layer), ThreadSpawnAccess);
});
it.effect(
  'depth counts parent edges from the root and refuses an incomplete lineage',
  Effect.fnUntraced(function* () {
    const root = record('root', null);
    const child = record('child', root.id);
    const helper = record('helper', child.id);
    const orphan = record('orphan', 'missing');
    const access = yield* accessOver(
      new Map([
        [root.id, []],
        [child.id, [root]],
        [helper.id, [child, root]],
      ]),
    );
    expect(yield* access.depth(root)).toEqual({ current: 0, maximum: 2, remaining: 2 });
    expect(yield* access.depth(child)).toEqual({ current: 1, maximum: 2, remaining: 1 });
    expect(yield* access.depth(helper)).toEqual({ current: 2, maximum: 2, remaining: 0 });
    expect(yield* Effect.flip(access.depth(orphan))).toBeInstanceOf(ThreadCallBroke);
  }),
);
