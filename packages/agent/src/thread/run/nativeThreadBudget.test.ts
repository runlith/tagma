import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import { makeThreadEntryReader } from '../../transcript/kinds';
import { threadStorageLayer } from '../kernelPorts';
import { ThreadBudget, ThreadBudgetSpentError, ThreadOwner } from '../ThreadPorts';
import { ThreadCallBroke } from '../ThreadBorder';
import { makeMemoryRows } from '../storage/memory/ThreadRows';
import { makeMemoryRuns } from '../storage/memory/ThreadRuns';
import { makeMemoryEvents } from '../storage/memory/ThreadEvents';
import { makeMemoryOwnerSettings } from '../storage/memory/OwnerSettings';
import { ThreadMemory } from '../storage/memory/state';
import { inMemoryThreadTransitions } from '../storage/memory/ThreadTransitions';
import { inMemoryInboxStorage } from '../storage/InMemoryInboxStorage';
import { emptyToolOutputs } from '../conformance/runCycle/runDoubles';
import { ThreadRunAccounting, threadRunAccountingLayer, accountedThreadBudgetLayer } from './ThreadRunAccounting';
import { spendable } from './spendable';
const OWNER = 'owner-1';
describe('accountedThreadBudgetLayer', () => {
  it.effect(
    'of sums the root and its deep descendants, read from the deepest thread',
    Effect.fnUntraced(function* () {
      const world = yield* budgetWorld();
      const tree = yield* world.seedTree(1000, 'root-a');
      const rootRun = yield* world.openRun(tree.root.id);
      const childRun = yield* world.openRun(tree.child.id);
      const grandRun = yield* world.openRun(tree.grandchild.id);
      yield* world.bill(rootRun.id, 100);
      yield* world.bill(childRun.id, 200);
      yield* world.bill(grandRun.id, 300);
      expect(yield* world.budgetOf(tree.grandchild.id)).toEqual({ allowed: 1000, spent: 600, remaining: 400 });
    }),
  );
  it.effect(
    'a detached child still counts: the root decides, never the parent link',
    Effect.fnUntraced(function* () {
      const world = yield* budgetWorld();
      const tree = yield* world.seedTree(1000, 'root-a');
      const rootRun = yield* world.openRun(tree.root.id);
      const childRun = yield* world.openRun(tree.child.id);
      yield* world.bill(rootRun.id, 100);
      yield* world.bill(childRun.id, 200);
      const loose = yield* world.child(tree.root.id, 'root-a-loose');
      const looseRun = yield* world.openRun(loose.id);
      yield* world.bill(looseRun.id, 150);
      const held = world.memory.held(loose.id);
      if (!held) return yield* Effect.die('Expected the loose child');
      held.row = { ...held.row, parentThreadId: null };
      expect((yield* world.threads.metadata(loose.id))?.parentThreadId).toBeNull();
      expect(yield* world.budgetOf(tree.root.id)).toEqual({ allowed: 1000, spent: 450, remaining: 550 });
      expect(yield* world.budgetOf(tree.child.id)).toEqual({ allowed: 1000, spent: 450, remaining: 550 });
    }),
  );
  it.effect(
    "another root's spend stays out, and a remainder never goes negative",
    Effect.fnUntraced(function* () {
      const world = yield* budgetWorld();
      const first = yield* world.seedTree(1000, 'root-a');
      const firstOwn = yield* world.openRun(first.root.id);
      const firstRun = yield* world.openRun(first.child.id);
      yield* world.bill(firstOwn.id, 50);
      yield* world.bill(firstRun.id, 200);
      const second = yield* world.seedTree(5000, 'root-b');
      const secondRun = yield* world.openRun(second.child.id);
      yield* world.bill(secondRun.id, 9999);
      expect(yield* world.budgetOf(first.root.id)).toEqual({ allowed: 1000, spent: 250, remaining: 750 });
      expect(yield* world.budgetOf(first.child.id)).toEqual({ allowed: 1000, spent: 250, remaining: 750 });
      expect(yield* world.budgetOf(second.root.id)).toEqual({ allowed: 5000, spent: 9999, remaining: 0 });
    }),
  );
  it.effect(
    'a root that declares no allowance bounds nothing, whatever the tree spent',
    Effect.fnUntraced(function* () {
      const world = yield* budgetWorld();
      const tree = yield* world.seedTree(null, 'root-a');
      const run = yield* world.openRun(tree.child.id);
      yield* world.bill(run.id, 10_000);
      expect(yield* world.budgetOf(tree.child.id)).toEqual({ allowed: null, spent: 0, remaining: null });
    }),
  );
  it.effect(
    'a foreign sender pays nothing: its exhausted tree never blocks the target',
    Effect.fnUntraced(function* () {
      const world = yield* budgetWorld();
      const sender = yield* world.seedTree(100, 'root-sender');
      const senderRun = yield* world.openRun(sender.child.id);
      yield* world.bill(senderRun.id, 150);
      expect(yield* world.budgetOf(sender.root.id)).toEqual({ allowed: 100, spent: 150, remaining: 0 });
      const target = yield* world.seedTree(1000, 'root-target');
      const billed = yield* world.openRun(target.child.id);
      yield* world.bill(billed.id, 100);
      yield* spendable(world.budget, yield* world.metadata(target.grandchild.id));
      const run = yield* world.openRun(target.grandchild.id);
      expect(run.threadId).toBe(target.grandchild.id);
      expect(run.status).toBe('running');
      expect((yield* world.runs.latestRun(target.grandchild.id))?.id).toBe(run.id);
      expect(yield* world.runs.isRunning(run.id)).toBe(true);
      expect(yield* world.budgetOf(target.root.id)).toEqual({ allowed: 1000, spent: 100, remaining: 900 });
    }),
  );
  it.effect(
    'an exhausted target refuses the next turn',
    Effect.fnUntraced(function* () {
      const world = yield* budgetWorld();
      const target = yield* world.seedTree(1000, 'root-target');
      const first = yield* world.openRun(target.root.id);
      const second = yield* world.openRun(target.child.id);
      yield* world.bill(first.id, 400);
      yield* world.bill(second.id, 600);
      expect(yield* world.budgetOf(target.root.id)).toEqual({ allowed: 1000, spent: 1000, remaining: 0 });
      const failure = yield* Effect.flip(spendable(world.budget, yield* world.metadata(target.grandchild.id)));
      expect(failure).toBeInstanceOf(ThreadCallBroke);
      expect(failure.cause).toBeInstanceOf(ThreadBudgetSpentError);
    }),
  );
});
const budgetWorld = Effect.fnUntraced(function* () {
  const unused = () => Effect.die('The budget contract does not use this operation');
  const memory = new ThreadMemory(makeThreadEntryReader({ products: [] }));
  const threads = makeMemoryRows({ memory });
  const runs = makeMemoryRuns({ memory, ownerId: 'test-instance', scope: null });
  const storage = threadStorageLayer({
    storage: threads,
    eventLog: makeMemoryEvents({ memory }),
    transitions: inMemoryThreadTransitions({ memory }),
    createRuns: () => runs,
    inbox: inMemoryInboxStorage({ units: memory.units, calls: memory.records }),
    ownerSettings: makeMemoryOwnerSettings({ memory }),
    attachments: { keep: unused, resolve: unused, addressed: unused, hydrate: unused, sizes: unused },
    toolOutputs: { scope: () => ({ ...emptyToolOutputs, commitReferenced: unused }), settleOpen: unused },
  });
  const context = yield* Layer.build(
    accountedThreadBudgetLayer.pipe(
      Layer.provideMerge(threadRunAccountingLayer),
      Layer.provideMerge(Layer.merge(storage, Layer.succeed(ThreadOwner, { id: runs.ownerId }))),
    ),
  );
  const budget = Context.get(context, ThreadBudget);
  const accounting = Context.get(context, ThreadRunAccounting);
  const child = (parentId: string, id: string) =>
    threads.transaction((tx) => threads.insertChild(parentId, { id, ownerId: OWNER, agentId: 'agent-1' }, tx));
  const metadata = Effect.fnUntraced(function* (id: string) {
    const row = yield* threads.metadata(id);
    if (!row) return yield* Effect.die(`Expected thread ${id}`);
    return row;
  });
  const seedTree = Effect.fnUntraced(function* (allowance: number | null, rootId: string) {
    const root = yield* threads.insert({ id: rootId, ownerId: OWNER, agentId: 'agent-1', budgetTokens: allowance });
    const born = yield* child(root.id, `${rootId}-child`);
    const grandchild = yield* child(born.id, `${rootId}-grand`);
    return { root, child: born, grandchild };
  });
  const openRun = Effect.fnUntraced(function* (threadId: string) {
    const row = yield* metadata(threadId);
    return (yield* runs.createRun({
      startFrom: row,
      kind: 'turn',
      approval: { mode: row.authority.mode, interactive: false },
      progress: { stage: 'running', message: null },
    })).run;
  });
  const budgetOf = Effect.fnUntraced(function* (threadId: string) {
    const thread = yield* metadata(threadId);
    const { allowed, spent, remaining } = yield* budget.of({ spawnRootId: thread.spawnRootId, principal: thread.ownerId });
    return { allowed, spent, remaining };
  });
  return {
    memory,
    threads,
    runs,
    budget,
    child,
    metadata,
    seedTree,
    openRun,
    budgetOf,
    bill: (runId: string, totalTokens: number) => accounting.usage(runId, new Usage({ totalTokens })),
  };
});
