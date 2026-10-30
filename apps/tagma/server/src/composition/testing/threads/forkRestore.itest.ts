import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { threadBranchEvent, type ThreadEventBody } from '@runlith/agent/thread/events';
import { userMessageEntryId } from '@runlith/agent/transcript/entryNames';
import { EvidenceReads } from '../../../threads/contract/service/evidence.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { evidenceReads } from '../../../native-harness/testing/doubles.js';
import { conversationReads, exportThreadRollout, replayThreadRollout, sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { ENTRY_KINDS } from '../../manifest.js';

const said = (turn: number, role: 'user' | 'assistant'): ThreadEventBody => {
  const text = `${role === 'user' ? 'question' : 'answer'} ${turn}`;
  return {
    kind: 'message',
    payload: {
      entry: {
        type: 'message',
        id: role === 'user' ? userMessageEntryId(`run-${turn}`) : `message:assistant:run-${turn}`,
        runId: `run-${turn}`,
        role,
        text,
        occurredAt: new Date(Date.UTC(2026, 9, 1, 8, turn)).toISOString(),
      },
      messages: [role === 'user' ? Message.user(text) : Message.assistant(text)],
    },
  };
};
const turn = (n: number) => [said(n, 'user'), said(n, 'assistant')];

it.live('rollouts restore a branch and its descendant after row loss, with a live or deleted source', () =>
  Effect.gen(function* () {
    const fixture = yield* threadStoreFixture;
    const { store, records, units, threads, projectId } = fixture;
    const context = Context.add(fixture.context, ThreadEntryKinds, ENTRY_KINDS);
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'fork-restore-' });
    const pathOf = (id: string) => join(home, `${id}.jsonl`);
    const log = yield* Effect.provide(sqliteThreadJournal(), context);
    const reads = yield* Effect.provide(evidenceReads(join(home, 'reads')), context);
    const conversations = yield* conversationReads().pipe(Effect.provideService(EvidenceReads, reads), Effect.provide(context));
    let sequence = 0;
    const append = (id: string, events: readonly ThreadEventBody[]) =>
      store.transaction((unit) =>
        Effect.forEach(events, (event) => log.append({ threadId: id, id: `event-${++sequence}`, ...event }, unit)),
      );
    const born = () =>
      units.write('forkRestore.born', (unit) =>
        Effect.gen(function* () {
          const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.attachFacet({ threadId: row.id, projectId }, unit);
          return row.id;
        }),
      );
    const branch = Effect.fnUntraced(function* (sourceId: string, hidden: readonly string[] = []) {
      const childId = yield* born();
      yield* store.transaction((unit) =>
        Effect.gen(function* () {
          const base = yield* store.branch({ sourceId, childId, entries: { kind: 'kept', taken: hidden }, prompts: 'kept' }, unit);
          if (hidden.length > 0) {
            const cut = threadBranchEvent({ hidden, prompts: 'kept', from: base.from, cuts: [] });
            yield* log.append({ threadId: childId, id: `event-${++sequence}`, ...cut }, unit);
          }
        }),
      );
      return childId;
    });
    const seen = Effect.fnUntraced(function* (id: string) {
      const transcript = yield* store.transcriptOf(id);
      const events = yield* log.eventsAfter(id, 0, 20);
      return { transcript, events: events.map(({ position, kind, payload }) => ({ position, kind, payload })) };
    });
    const filed = (id: string, prefix = false) =>
      Effect.provide(exportThreadRollout({ threadId: id, path: pathOf(id), parts: nativeOnlyParts, prefix }), context);
    const branched = Effect.fnUntraced(function* () {
      const source = yield* born();
      yield* append(source, [...turn(1), ...turn(2)]);
      const child = yield* branch(source, ['run-2']);
      yield* append(child, turn(3));
      return { source, child };
    });
    const kept = yield* branched();
    const gone = yield* branched();
    const grandchild = yield* branch(gone.child);
    yield* append(grandchild, turn(4));
    yield* store.delete([gone.source]);
    const ids = [kept.source, kept.child, gone.child, grandchild];
    const before = new Map(yield* Effect.forEach(ids, (id) => Effect.map(seen(id), (value) => [id, value] as const)));
    expect(before.get(kept.child)?.transcript?.some((entry) => entry.runId === 'run-2')).toBe(false);
    for (const id of ids) yield* filed(id, id === gone.child);
    const sources = new Map(ids.map((id) => [id, pathOf(id)] as const));
    yield* units.write(records.writes, (unit) => records.remove(unit, ids));
    expect(yield* records.facts(kept.child)).toBeUndefined();
    const restored = yield* Effect.forEach(ids, (id) =>
      Effect.provide(replayThreadRollout({ path: pathOf(id), parts: nativeOnlyParts, records, sources }), context),
    );
    expect(restored.map((row) => row.threadId)).toEqual(ids);
    expect(restored.find((row) => row.threadId === kept.child)?.inherited).toBeGreaterThan(0);
    for (const id of ids) expect(yield* seen(id)).toEqual(before.get(id)!);
    for (const id of [kept.child, gone.child]) {
      const page = yield* conversations.search(
        { kind: 'operator' },
        { scope: { kind: 'all', removed: [] }, limit: 20, query: 'question', threadId: id },
      );
      expect(page.matches.map((hit) => hit.match.entryId)).toEqual([userMessageEntryId('run-3'), userMessageEntryId('run-1')]);
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
