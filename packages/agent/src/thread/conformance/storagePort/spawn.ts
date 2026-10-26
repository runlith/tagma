import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { ThreadStorageFailed } from '../../persisted';
import type { ThreadTeamPosition } from '../../storage/aggregate';
import type { ThreadStorageFactory } from '../storagePort';
import { INSTANCE, OWNER, SCOPE, started, startInput } from './support';
export function describeThreadSpawnPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: thread spawn port`, () => {
    test(
      'a spawned child is born only through insertChild, and spawns as deep as it is asked',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const parent = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        expect(
          yield* Effect.flip(harness.aggregate.insert({ ownerId: OWNER, agentId: 'agent', parentThreadId: parent.id })),
        ).toBeInstanceOf(ThreadStorageFailed);
        const spawn = (parentId: string) =>
          harness.aggregate.transaction((tx) => harness.aggregate.insertChild(parentId, { ownerId: OWNER, agentId: 'agent' }, tx));
        const child = yield* spawn(parent.id);
        const grandchild = yield* spawn(child.id);
        const greatGrandchild = yield* spawn(grandchild.id);
        expect(child.parentThreadId).toBe(parent.id);
        expect(grandchild.parentThreadId).toBe(child.id);
        expect(greatGrandchild.parentThreadId).toBe(grandchild.id);
        expect((yield* harness.aggregate.listByParent(OWNER, parent.id)).map((row) => row.id)).toEqual([child.id]);
        expect((yield* harness.aggregate.listByParent(OWNER, child.id)).map((row) => row.id)).toEqual([grandchild.id]);
        expect(yield* harness.transitions.writeAt(grandchild.id, ({ row }) => Effect.succeed(row.id))).toBe(grandchild.id);
        yield* harness.aggregate.delete([parent.id]);
        expect(yield* harness.aggregate.find(greatGrandchild.id)).toBeUndefined();
      }),
    );
    test(
      'a team is read page by page from a key, resting threads apart from the running ones, and counted whole',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const parent = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const stranger = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const spawn = (parentId: string) =>
          harness.aggregate.transaction((tx) => harness.aggregate.insertChild(parentId, { ownerId: OWNER, agentId: 'agent' }, tx));
        const children = [yield* spawn(parent.id), yield* spawn(parent.id), yield* spawn(parent.id), yield* spawn(parent.id)];
        const grandchild = yield* spawn(children[0]!.id);
        yield* spawn(stranger.id);
        const going = yield* started(harness.runs({ ownerId: INSTANCE, scope: SCOPE }).createRun(startInput(children[1]!)));
        const team = { spawnRootId: parent.spawnRootId, ownerId: OWNER };
        const running = yield* harness.aggregate.pageTeam({ ...team, within: 'running', limit: 10 });
        expect(running.rows.map((row) => row.id)).toEqual([children[1]!.id]);
        expect(running.total).toBe(6);
        expect(going.threadId).toBe(children[1]!.id);
        const walked: string[] = [];
        let after: ThreadTeamPosition | undefined;
        for (;;) {
          const page = yield* harness.aggregate.pageTeam({ ...team, within: 'resting', limit: 2, after });
          walked.push(...page.rows.map((row) => row.id));
          const last = page.rows.at(-1);
          if (page.rows.length < 2 || !last) break;
          after = { movedAt: last.updatedAt, id: last.id };
        }
        const resting = [parent.id, children[0]!.id, children[2]!.id, children[3]!.id, grandchild.id];
        expect([...walked].sort()).toEqual([...resting].sort());
        expect(new Set(walked).size).toBe(walked.length);
        const childrenOnly = yield* harness.aggregate.pageTeam({ ...team, parent: parent.id, within: 'resting', limit: 10 });
        expect(childrenOnly.rows.map((row) => row.id).sort()).toEqual([children[0]!.id, children[2]!.id, children[3]!.id].sort());
        expect(childrenOnly.total).toBe(4);
      }),
    );
    test(
      'the act a thread was born of reads back from every read, and a birth naming none reads null',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const parent = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const act = { by: 'run-of-parent', step: 7 };
        const child = yield* harness.aggregate.transaction((tx) =>
          harness.aggregate.insertChild(parent.id, { ownerId: OWNER, agentId: 'agent', bornOf: act }, tx),
        );
        const unnamed = yield* harness.aggregate.transaction((tx) =>
          harness.aggregate.insertChild(parent.id, { ownerId: OWNER, agentId: 'agent' }, tx),
        );
        const root = yield* harness.aggregate.insert({ ownerId: OWNER, agentId: 'agent', bornOf: act });
        expect(child.bornOf).toEqual(act);
        expect((yield* harness.aggregate.find(child.id))?.bornOf).toEqual(act);
        expect((yield* harness.aggregate.metadata(child.id))?.bornOf).toEqual(act);
        expect((yield* harness.aggregate.find(root.id))?.bornOf).toEqual(act);
        expect((yield* harness.aggregate.listByParent(OWNER, parent.id)).map((row) => [row.id, row.bornOf])).toEqual(
          expect.arrayContaining([
            [child.id, act],
            [unnamed.id, null],
          ]),
        );
        expect(parent.bornOf).toBeNull();
        expect((yield* harness.aggregate.find(unnamed.id))?.bornOf).toBeNull();
      }),
    );
    test(
      'a child is born under the authority its parent holds at the birth',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const root = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const spawn = (parentId: string) =>
          harness.aggregate.transaction((tx) => harness.aggregate.insertChild(parentId, { ownerId: OWNER, agentId: 'agent' }, tx));
        const before = yield* spawn(root.id);
        const bypassing = { mode: 'bypass' as const, bypassFrom: root.id };
        yield* harness.aggregate.update(root.id, { authority: bypassing });
        expect((yield* spawn(root.id)).authority).toEqual(bypassing);
        expect((yield* harness.aggregate.find(before.id))?.authority).toEqual({ mode: 'trust', bypassFrom: null });
      }),
    );
    test(
      'a name is one live address inside its spawn root, and another root may reuse it',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const root = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        expect(root.spawnRootId).toBe(root.id);
        expect(root.name).toBeNull();
        const spawn = (parentId: string, name?: string) =>
          harness.aggregate.transaction((tx) => harness.aggregate.insertChild(parentId, { ownerId: OWNER, agentId: 'agent', name }, tx));
        const researcher = yield* spawn(root.id, 'researcher');
        const deeper = yield* spawn(researcher.id, 'reader');
        expect(researcher.spawnRootId).toBe(root.id);
        expect(deeper.spawnRootId).toBe(root.id);
        expect((yield* harness.aggregate.findNamed(root.id, OWNER, 'researcher'))?.id).toBe(researcher.id);
        expect((yield* harness.aggregate.findNamed(root.id, OWNER, 'reader'))?.id).toBe(deeper.id);
        expect(yield* harness.aggregate.findNamed(root.id, OWNER, 'nobody')).toBeUndefined();
        expect(yield* Effect.flip(spawn(root.id, 'researcher'))).toBeInstanceOf(ThreadStorageFailed);
        const twin = yield* spawn(other.id, 'researcher');
        expect((yield* harness.aggregate.findNamed(other.id, OWNER, 'researcher'))?.id).toBe(twin.id);
        expect(twin.id).not.toBe(researcher.id);
        const team = (spawnRootId: string, ownerId: string) =>
          harness.aggregate.pageTeam({ spawnRootId, ownerId, within: 'resting', limit: 50 });
        expect((yield* team(root.id, OWNER)).rows.map((row) => row.id).sort()).toEqual([root.id, researcher.id, deeper.id].sort());
        expect((yield* team(other.id, OWNER)).total).toBe(2);
        expect((yield* team(root.id, 'another-owner')).total).toBe(0);
        yield* spawn(root.id);
        yield* spawn(root.id);
        expect(yield* harness.aggregate.listByParent(OWNER, root.id)).toHaveLength(3);
      }),
    );
    test(
      'a root is its own cache group, a child carries its parent’s unless its birth names one, and a branch names its source’s',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const root = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        expect(root.cacheGroup).toBe(root.id);
        const child = yield* harness.aggregate.transaction((tx) =>
          harness.aggregate.insertChild(root.id, { ownerId: OWNER, agentId: 'agent' }, tx),
        );
        const deeper = yield* harness.aggregate.transaction((tx) =>
          harness.aggregate.insertChild(child.id, { ownerId: OWNER, agentId: 'agent' }, tx),
        );
        const named = yield* harness.aggregate.transaction((tx) =>
          harness.aggregate.insertChild(root.id, { ownerId: OWNER, agentId: 'agent', cacheGroup: 'named-elsewhere' }, tx),
        );
        expect(child.cacheGroup).toBe(root.id);
        expect(deeper.cacheGroup).toBe(root.id);
        expect((yield* harness.aggregate.find(named.id))?.cacheGroup).toBe('named-elsewhere');
        const branch = yield* harness.aggregate.insert({ ownerId: OWNER, agentId: 'agent', cacheGroup: root.id });
        expect(branch.spawnRootId).toBe(branch.id);
        expect(branch.cacheGroup).toBe(root.id);
        expect((yield* harness.aggregate.find(branch.id))?.cacheGroup).toBe(root.id);
      }),
    );
  });
}
