import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { threadStoreFixture } from '../threadStoreFixture.js';
import type { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { readThreadTitle } from '../../../threads/testing/doubles.js';

const titleIdentity = (records: ThreadRecords['Service'], id: string) =>
  Effect.map(records.facts(id), (facts) =>
    facts === undefined ? undefined : { title: facts.title, origin: facts.titleProvenance, revision: facts.titleRevision },
  );

const born = Effect.fnUntraced(function* (title?: string) {
  const { records, store, threads, units, projectId } = yield* threadStoreFixture;
  const titles = {
    identity: (id: string) => titleIdentity(records, id),
    setTitle: (id: string, title: string) => units.write(records.writes, (unit) => records.setTitle(unit, id, title, 'manual')),
    name: (id: string, title: string, expected: number) =>
      units.write(records.writes, (unit) => records.nameTitle(unit, id, title, expected)),
    claim: (id: string, input: string) => units.write(records.writes, (unit) => records.claimTitleInput(unit, id, input)),
  };
  const created = yield* units.write('ThreadTitles.created', (unit) =>
    Effect.gen(function* () {
      const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
      yield* threads.rows.attachFacet({ threadId: row.id, projectId, title }, unit);
      return row;
    }),
  );
  return { titles, threadId: created.id };
});

it.live(
  'a name written against a stale revision does not land, and the rename stands',
  Effect.fnUntraced(function* () {
    const { titles, threadId } = yield* born();
    const before = yield* titles.identity(threadId);
    expect(before?.origin).toBe('random');
    yield* titles.setTitle(threadId, 'the operator name');
    const wrote = yield* titles.name(threadId, 'the operator name', before?.revision ?? 0);
    expect(wrote.outcome).toBe('superseded');
    const after = yield* titles.identity(threadId);
    expect(after?.title).toBe('the operator name');
    expect(after?.origin).toBe('manual');
  }),
);

it.live(
  'the naming right is taken once per reader input, and never after a manual name',
  Effect.fnUntraced(function* () {
    const { titles, threadId } = yield* born();
    const first = yield* titles.claim(threadId, 'entry-1');
    expect(first?.origin).toBe('random');
    expect(yield* titles.claim(threadId, 'entry-1')).toBeUndefined();
    const second = yield* titles.claim(threadId, 'entry-2');
    expect(second?.revision).toBe(first?.revision);
    yield* titles.setTitle(threadId, 'named by hand');
    expect(yield* titles.claim(threadId, 'entry-3')).toBeUndefined();
  }),
);

it.live(
  'a birth with a title is manual, and a birth without one is a random name',
  Effect.fnUntraced(function* () {
    const named = yield* born('what the operator called it');
    const chosen = yield* named.titles.identity(named.threadId);
    expect(chosen?.title).toBe('what the operator called it');
    expect(chosen?.origin).toBe('manual');
    const unnamed = yield* born();
    const random = yield* unnamed.titles.identity(unnamed.threadId);
    expect(random?.origin).toBe('random');
    expect(random?.title).toMatch(/^[a-z]+-[a-z]+$/);
  }),
);

test('the answer decoder tells a name from no topic and from a malformed reply', () => {
  const stopped = (text: string) => ({ text, finishReason: 'stop' as const, usage: undefined });
  expect(readThreadTitle(stopped('TITLE: Prompt cache reuse'))).toEqual({ kind: 'named', title: 'Prompt cache reuse' });
  expect(readThreadTitle(stopped('  TITLE: "Thread titles"  \n'))).toEqual({ kind: 'named', title: 'Thread titles' });
  expect(readThreadTitle(stopped('TITLE: Conditional title write'))).toEqual({
    kind: 'named',
    title: 'Conditional title write',
  });
  expect(readThreadTitle(stopped('NO-TOPIC'))).toEqual({ kind: 'no-topic' });
  expect(readThreadTitle(stopped(''))).toEqual({ kind: 'failed', reason: 'empty-answer' });
  expect(readThreadTitle(stopped('TITLE: Вложения и PDF в Tagma'))).toEqual({ kind: 'named', title: 'Вложения и PDF в Tagma' });
  expect(
    readThreadTitle(
      stopped('TITLE: here is a good name for your caching conversation that explains everything the assistant did today in detail'),
    ),
  ).toEqual({ kind: 'failed', reason: 'too-long' });
  expect(readThreadTitle(stopped('TITLE:'))).toEqual({ kind: 'failed', reason: 'empty-title' });
  expect(readThreadTitle(stopped('I cannot name this.'))).toEqual({ kind: 'failed', reason: 'missing-frame' });
  expect(readThreadTitle(stopped('Cache reuse'))).toEqual({ kind: 'failed', reason: 'missing-frame' });
  expect(readThreadTitle(stopped('Sure!\nTITLE: Cache reuse\nLet me know if that works.'))).toEqual({
    kind: 'failed',
    reason: 'extra-lines',
  });
  expect(readThreadTitle({ text: 'Cache reuse', finishReason: 'length', usage: undefined })).toEqual({
    kind: 'failed',
    reason: 'incomplete-answer',
  });
});
