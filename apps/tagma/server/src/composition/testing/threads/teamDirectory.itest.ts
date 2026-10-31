import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import type { Cursor } from '@runlith/paging';
import { threadDirectoryStore, threadRun } from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../composed.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

const setup = Effect.fnUntraced(function* () {
  const first = yield* threadStoreFixture;
  const second = yield* threadStoreFixture;
  const a = first.projectId;
  const b = second.projectId;
  const { db, records, store, threads: parts } = first;
  const directory = yield* Effect.provide(threadDirectoryStore(ENTRY_KINDS), first.context);
  const [parent, child, newest, outsider] = yield* store.transaction((tx) =>
    Effect.gen(function* () {
      const lead = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
      yield* records.scope(tx, lead.id, { projectId: a, title: 'lead', titleOrigin: 'agent' });
      const worker = yield* store.insertChild(lead.id, { ownerId: 'operator', agentId: 'tagma', name: 'worker' }, tx);
      yield* records.scope(tx, worker.id, { projectId: b, title: 'worker', titleOrigin: 'agent' });
      const recent = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
      yield* records.scope(tx, recent.id, { projectId: a, title: 'recent', titleOrigin: 'agent' });
      const outside = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
      yield* records.scope(tx, outside.id, { projectId: b, title: 'outside', titleOrigin: 'agent' });
      yield* records.advanceReaderOrder(tx, recent.id, new Date((yield* Clock.currentTimeMillis) + 1));
      yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
      return [lead.id, worker.id, recent.id, outside.id] as const;
    }),
  );
  return { db, parts, a, b, parent, child, newest, outsider, directory };
});

it.live(
  'the directory pages agents across homes with their project and keeps principal isolation',
  Effect.fnUntraced(function* () {
    const { b, parent, child, newest, outsider, directory } = yield* setup();
    const first = yield* directory.list({ from: parent, principal: 'operator', limit: 1 });
    const rows = [...first.rows];
    let cursor: Cursor | null = first.cursor;
    while (cursor !== null) {
      const next = yield* directory.list({ from: parent, principal: 'operator', limit: 1, cursor });
      rows.push(...next.rows);
      cursor = next.cursor;
    }
    expect(first.total).toBe(4);
    expect(rows.map((row) => row.threadId).sort()).toEqual([parent, child, newest, outsider].sort());
    expect(rows.find((row) => row.threadId === child)).toMatchObject({ projectId: b, spawnRootId: parent, parentThreadId: parent });
    expect(yield* directory.list({ from: parent, principal: 'another', limit: 1 })).toEqual({ rows: [], total: 0, cursor: null });
  }),
);

it.live(
  'a foreign child belongs to its project list and its parent’s team, and its running run keeps an older parent in the window',
  Effect.fnUntraced(function* () {
    const { db, parts, a, b, parent, child, newest, outsider } = yield* setup();
    const list = parts.list;
    expect((yield* list.rootWindow('operator', [a], { limit: 2 })).rows.map((row) => row.id).sort()).toEqual(
      [parent, child, newest].sort(),
    );
    expect((yield* list.list('operator', { id: b, projects: [b] }, { view: 'live', limit: 2 })).rows.map((row) => row.id).sort()).toEqual(
      [child, outsider].sort(),
    );
    yield* db.insert(threadRun()).values({
      id: 'foreign-run',
      threadId: child,
      ownerId: 'operator',
      status: 'running',
      progress: { stage: 'running', message: null },
    });
    const window = yield* list.rootWindow('operator', [a], { limit: 1 });
    expect(window.roots).toBe(2);
    expect(window.rows.map((row) => row.id).sort()).toEqual([parent, child, newest].sort());
    expect(window.rows.find((row) => row.id === child)).toMatchObject({ projectId: b, life: 'working', parentThreadId: parent });
  }),
);
