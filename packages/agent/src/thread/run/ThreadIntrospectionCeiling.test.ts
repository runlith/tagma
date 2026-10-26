import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import {
  RECORDS_PER_QUERY,
  ThreadIntrospection,
  threadIntrospectionLayer,
  type ThreadQueryInput,
  type ThreadQueryStop,
} from './ThreadIntrospection';
import { ThreadEventJournal, ThreadStore } from '../ThreadPorts';
import { ThreadEntryKinds } from '../../transcript/kinds';
import { ThreadRunLedger } from './ThreadRunLedger';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
import type { ThreadEventRevision, ThreadRecordWindow } from '../storage/eventLog';
const threadId = 'thread-wide';
const occurredAt = '2026-09-22T00:00:00.000Z';
const head = RECORDS_PER_QUERY + 1;
const unused = () => Effect.die('The ceiling query does not use this operation');
type EvidenceInput = { readonly text?: string };
function event(position: number, text?: string): ThreadEventRevision {
  return {
    threadId,
    position,
    id: `event-${position}`,
    kind: 'message',
    identity: `entry-${position}`,
    payload: { entry: { type: 'message', id: `entry-${position}`, role: 'user', text: text ?? `row ${position}`, occurredAt } },
  };
}
function windowed(window: ThreadRecordWindow, text?: string): readonly ThreadEventRevision[] {
  const from = window.afterPosition + 1;
  const to = Math.min(window.head, from + window.limit - 1);
  const made: ThreadEventRevision[] = [];
  for (let position = from; position <= to; position += 1) made.push(event(position, text));
  return made;
}
const layer = ({ text }: EvidenceInput = {}) =>
  threadIntrospectionLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          ThreadEventJournal,
          ThreadEventJournal.of({
            append: unused,
            recordsAsOf: (_threadId, window) => Effect.sync(() => windowed(window, text)),
            revisionsAsOf: (_threadId, window) => Effect.sync(() => windowed(window, text)),
            eventsAfter: unused,
            headPosition: unused,
            positionOf: unused,
          }),
        ),
        Layer.succeed(
          ThreadRunLedger,
          ThreadRunLedger.of({
            runById: unused,
            isRunning: unused,
            runningHere: unused,
            activeRun: unused,
            activeRunIn: unused,
            runningOf: unused,
            latestRun: unused,
            runsOf: unused,
            latestRuns: unused,
            reapable: unused,
          }),
        ),
        Layer.succeed(ThreadStore, makeAggregateStorage()),
        ThreadEntryKinds.layer([]),
      ),
    ),
  );
const over = (query: ThreadQueryInput['query'], selectedHead = head, from?: ThreadQueryInput['from'], seed?: ThreadQueryInput['seed']) =>
  Effect.flatMap(ThreadIntrospection, (introspection) =>
    introspection.query({ query, targets: [{ threadId, head: selectedHead, runs: [] }], from, seed }),
  ).pipe(Effect.provide(layer()));
describe('the reading’s own work ceiling', () => {
  it.effect(
    'run pages continue from their run identity and leave a short last page complete',
    Effect.fnUntraced(function* () {
      const targets = [{ threadId, head: 0, runs: Array.from({ length: 3 }, (_, index) => ({ threadId, runId: `run-${index + 1}` })) }];
      const read = (from?: ThreadQueryStop) =>
        Effect.flatMap(ThreadIntrospection, (introspection) =>
          introspection.query({
            query: { select: 'runs', fields: ['runId'], limit: 2 },
            targets,
            from,
          }),
        ).pipe(Effect.provide(layer()));
      const first = yield* read();
      const last = yield* read(first.next ?? undefined);
      expect({
        first: first.rows.map((row) => row.runId),
        next: first.next,
        last: last.rows.map((row) => row.runId),
        complete: last.coverage.complete,
      }).toEqual({ first: ['run-1', 'run-2'], next: { kind: 'source', at: 0, sourceKey: 'run-2' }, last: ['run-3'], complete: true });
    }),
  );
  it.effect(
    'byte windows count the same UTF-8 payload in Latin and Cyrillic text',
    Effect.fnUntraced(function* () {
      const read = (text: string) =>
        Effect.flatMap(ThreadIntrospection, (introspection) =>
          introspection.query({
            query: { select: 'entries', fields: ['text'] },
            targets: [{ threadId, head: 3, runs: [] }],
          }),
        ).pipe(Effect.provide(layer({ text })));
      const latin = yield* read('x'.repeat(400_000));
      const cyrillic = yield* read('Я'.repeat(200_000));
      expect(latin.coverage.complete).toBe(false);
      expect({ positions: cyrillic.rows.map((row) => row.at), coverage: cyrillic.coverage, next: cyrillic.next }).toEqual({
        positions: latin.rows.map((row) => row.at),
        coverage: latin.coverage,
        next: latin.next,
      });
    }),
  );
  it.effect(
    'ordering uses the source fields before the requested projection',
    Effect.fnUntraced(function* () {
      const answer = yield* over({ select: 'entries', fields: ['kind'], order: { by: 'text', dir: 'desc' }, limit: 1 }, 3);
      expect(answer.rows).toEqual([{ threadId, at: 3, kind: 'message' }]);
    }),
  );
  it.effect(
    'an aggregate past the ceiling answers a cut population, and continued with its totals covers the whole',
    Effect.fnUntraced(function* () {
      const counting = { select: 'entries', where: [{ field: 'threadId', op: 'exists', value: true }], count: true } as const;
      const answer = yield* over(counting);
      expect(answer.coverage.read).toBe(RECORDS_PER_QUERY);
      expect(answer.coverage.complete).toBe(false);
      expect(answer.coverage.cut).toBe('read-ceiling');
      expect(answer.groups?.[0]?.count).toBe(RECORDS_PER_QUERY);
      expect(answer.groups?.[0]?.count).toBeLessThan(head);
      expect(answer.next).toMatchObject({ kind: 'source' });
      const rest = yield* over(counting, head, answer.next ?? undefined, answer.groups);
      expect(rest.coverage.complete).toBe(true);
      expect(rest.groups?.[0]?.count).toBe(head);
    }),
  );
  it.effect(
    'a ranking past the ceiling ranks what it read and never calls it the whole population',
    Effect.fnUntraced(function* () {
      const answer = yield* over({
        select: 'entries',
        where: [{ field: 'threadId', op: 'exists', value: true }],
        fields: ['at'],
        order: { by: 'at', dir: 'desc' },
        limit: 1,
      });
      expect(answer.rows.map((row) => row.at)).toEqual([RECORDS_PER_QUERY]);
      expect(answer.coverage.complete).toBe(false);
      expect(answer.coverage.cut).toBe('read-ceiling');
    }),
  );
  it.effect(
    'a population inside the ceiling is read whole and says nothing about a cut',
    Effect.fnUntraced(function* () {
      const small = RECORDS_PER_QUERY - 1;
      const answer = yield* over({ select: 'entries', where: [{ field: 'threadId', op: 'exists', value: true }], count: true }, small);
      expect(answer.coverage.complete).toBe(true);
      expect(answer.coverage.cut).toBeUndefined();
      expect(answer.groups?.[0]?.count).toBe(small);
    }),
  );
});
