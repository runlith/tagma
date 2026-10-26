import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { ThreadContextEvidence } from '../rows';
import { readThreadContextEvidence, readThreadRunStepsTaken, THREAD_TAIL_POSITIONS, threadContextChangeEvent } from '../events';
import type { ThreadEventLogStorage, ThreadEventRow, ThreadRecordWindow } from '../storage/eventLog';
import { makeThreadEntryReader } from '../../transcript/kinds';
const entryKinds = makeThreadEntryReader({ products: [] });
type MemoryLogInput = { readonly rows: ThreadEventRow[] };
type MemoryLog = ThreadEventLogStorage<undefined> & {
  readonly rows: ThreadEventRow[];
  readonly windows: ThreadRecordWindow[];
  readonly addresses: string[];
};
const row = (threadId: string, position: number, kind: string, payload: ThreadEventRow['payload']): ThreadEventRow => ({
  threadId,
  position,
  id: `row-${position}`,
  kind,
  payload,
});
const stepRow = (threadId: string, position: number, runId: string, stepNumber: number): ThreadEventRow =>
  row(threadId, position, 'step', {
    context: { runId, stepNumber, provider: null, model: null, contextWindow: null, measuredAt: '2026-09-22T19:00:00.000Z' },
  });
const toolRow = (position: number) => row('t', position, 'tool', { entry: { type: 'tool', id: `tool-${position}` } });
function makeLog({ rows }: MemoryLogInput): MemoryLog {
  const windows: ThreadRecordWindow[] = [];
  const addresses: string[] = [];
  return {
    rows,
    windows,
    addresses,
    append: (event) =>
      Effect.sync(() => {
        const written = row(event.threadId, rows.length + 1, event.kind, event.payload);
        rows.push(written);
        return written;
      }),
    eventsAfter: (threadId, afterPosition, limit) =>
      Effect.sync(() => rows.filter((one) => one.threadId === threadId && one.position > afterPosition).slice(0, limit)),
    recordsAsOf: (threadId, window) =>
      Effect.sync(() => {
        windows.push(window);
        return rows
          .filter(
            (one) =>
              one.threadId === threadId &&
              one.position > window.afterPosition &&
              one.position <= window.head &&
              (window.kinds === undefined || window.kinds.includes(one.kind)),
          )
          .slice(0, window.limit);
      }),
    revisionsAsOf: () => Effect.die('The tail reader does not read entry revisions.'),
    headPosition: (threadId) =>
      Effect.sync(() => rows.reduce((most, one) => (one.threadId === threadId ? Math.max(most, one.position) : most), 0)),
    positionOf: (threadId, recordId) =>
      Effect.sync(() => {
        addresses.push(recordId);
        let found: number | null = null;
        for (const one of rows) {
          if (one.threadId === threadId && (one.id === recordId || (one.payload.entry as { id?: string } | undefined)?.id === recordId))
            found = Math.max(found ?? 0, one.position);
        }
        return found;
      }),
  };
}
describe('the run step marks a log answers with a tail window', () => {
  it.effect(
    'a run owning the newest block is read from the tail, never from the whole history',
    Effect.fnUntraced(function* () {
      const head = THREAD_TAIL_POSITIONS + 3;
      const log = makeLog({
        rows: [stepRow('t', head - 2, 'run-old', 5000), stepRow('t', head - 1, 'run-new', 12), stepRow('t', head, 'run-new', 13)],
      });
      expect(yield* readThreadRunStepsTaken(log, entryKinds, { id: 'run-new', threadId: 't' })).toBe(14);
      expect(log.windows).toHaveLength(1);
      expect(log.windows[0]!.afterPosition).toBe(head - THREAD_TAIL_POSITIONS);
      expect(log.windows[0]!.limit).toBe(THREAD_TAIL_POSITIONS);
      expect(log.windows[0]!.kinds).toEqual(['step', 'step-finished']);
    }),
  );
  it.effect(
    'a run that has taken no step is answered from another run’s newest row',
    Effect.fnUntraced(function* () {
      const log = makeLog({ rows: [stepRow('t', 1, 'run-old', 0), stepRow('t', 2, 'run-old', 1)] });
      expect(yield* readThreadRunStepsTaken(log, entryKinds, { id: 'run-new', threadId: 't' })).toBe(0);
      expect(log.windows).toHaveLength(1);
    }),
  );
  it.effect(
    'a run after a quiet stretch answers its own count in reads logarithmic in the stretch',
    Effect.fnUntraced(function* () {
      const head = 100_000;
      const log = makeLog({
        rows: [stepRow('t', 1, 'run-old', 0), stepRow('t', 2, 'run-old', 1), stepRow('t', 3, 'run-old', 2), toolRow(head)],
      });
      expect(yield* readThreadRunStepsTaken(log, entryKinds, { id: 'run-old', threadId: 't' })).toBe(3);
      expect(log.windows.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(head)) + 2);
      expect(log.windows.every((one) => one.limit <= THREAD_TAIL_POSITIONS)).toBe(true);
    }),
  );
  it.effect(
    'a step just past a tail window still counts, and a thread with no step answers zero',
    Effect.fnUntraced(function* () {
      const log = makeLog({ rows: [stepRow('t', 500, 'run-old', 3), toolRow(900)] });
      const stepless = makeLog({ rows: log.rows.filter((one) => one.kind !== 'step') });
      expect(yield* readThreadRunStepsTaken(log, entryKinds, { id: 'run-old', threadId: 't' })).toBe(4);
      expect(yield* readThreadRunStepsTaken(stepless, entryKinds, { id: 'run-old', threadId: 't' })).toBe(0);
    }),
  );
});
describe('the evidence a run was admitted with', () => {
  it.effect(
    'is addressed by the change’s own entry id and read as one row',
    Effect.fnUntraced(function* () {
      const evidence: ThreadContextEvidence = {
        instructions: 'the instructions this run was admitted with',
        tools: ['read_thread'],
        profileId: null,
        approvalMode: 'trust',
      };
      const published = threadContextChangeEvent({
        requestId: 'request-1',
        runId: 'run-1',
        sourceKey: 'source-1',
        fromGeneration: 0,
        outcome: 'published',
        record: { generation: 1, sourceKey: 'source-1', requestId: 'request-1' },
        evidence,
        requestedAt: '2026-09-22T19:00:00.000Z',
        settledAt: '2026-09-22T19:00:01.000Z',
      });
      const log = makeLog({ rows: [row('t', 41, published.kind, published.payload)] });
      const found = yield* readThreadContextEvidence(log, entryKinds, { threadId: 't', runId: 'run-1', requestId: 'request-1' });
      expect(found?.requestId).toBe('request-1');
      expect(found?.evidence).toEqual(evidence);
      expect(log.windows).toHaveLength(1);
      expect(log.windows[0]).toMatchObject({ limit: 1, afterPosition: 40, kinds: ['context-change'] });
    }),
  );
  it.effect(
    'answers nothing when the change was never written',
    Effect.fnUntraced(function* () {
      const log = makeLog({ rows: [stepRow('t', 1, 'run-1', 0)] });
      expect(yield* readThreadContextEvidence(log, entryKinds, { threadId: 't', runId: 'run-1', requestId: 'nope' })).toBeNull();
      expect(log.windows).toHaveLength(0);
    }),
  );
});
