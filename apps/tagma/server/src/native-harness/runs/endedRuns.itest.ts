import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Tracer } from 'effect';
import { openThreadStoreAt } from '../../composition/testing/storageHarness.js';

const HISTORY = 40;
const PAGE = 5;

it.live('an endings page, the latest ending and a run lookup seek by index and never scan or sort the run history', () =>
  Effect.gen(function* () {
    const directory = mkdtempSync(join(tmpdir(), 'tagma-endings-'));
    const path = join(directory, 'tagma.sqlite');
    const { storage } = yield* openThreadStoreAt(directory, path);
    const thread = yield* storage.createThread({ ownerId: 'owner', scope: 'scope-a' });
    const runs = storage.runs({ ownerId: 'instance-1', scope: 'scope-a' });
    for (let index = 0; index < HISTORY; index += 1) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, 0, index));
      const started = yield* runs.createRun({
        startFrom: {
          id: thread.id,
          ownerId: thread.ownerId,
          account: null,
          provider: thread.provider,
          model: null,
          reasoning: null,
          switches: {},
        },
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: 'starting', message: null },
        startKey: { key: `turn-${index}`, digest: `digest-${index}` },
      });
      yield* runs.settleRun(started.run.id, {
        status: 'completed',
        progress: { stage: 'completed', message: null },
        finishedAt: at,
        heartbeatAt: at,
      });
    }

    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const traced = <A, E>(work: Effect.Effect<A, E>) => work.pipe(Effect.withTracer(tracer));

    const first = yield* traced(runs.settledRuns({ threadIds: [thread.id], limit: PAGE }));
    expect(first.total).toBe(HISTORY);
    expect(first.rows).toHaveLength(PAGE);
    const last = first.rows.at(-1)!;
    const next = yield* traced(
      runs.settledRuns({ threadIds: [thread.id], limit: PAGE, after: { finishedAt: last.finishedAt!, id: last.id } }),
    );
    expect(next.rows.map((row) => row.finishedAt!.getTime())).toEqual(first.rows.map((row) => row.finishedAt!.getTime() - PAGE * 1_000));
    let deep = next;
    for (let page = 2; page < HISTORY / PAGE; page += 1) {
      const edge = deep.rows.at(-1)!;
      deep = yield* traced(runs.settledRuns({ threadIds: [thread.id], limit: PAGE, after: { finishedAt: edge.finishedAt!, id: edge.id } }));
    }
    expect(deep.rows.map((row) => row.finishedAt!.getTime())).toEqual(
      first.rows.map((row) => row.finishedAt!.getTime() - (HISTORY - PAGE) * 1_000),
    );
    const [latest] = yield* traced(runs.newestSettled([thread.id], 1));
    expect(latest?.id).toBe(first.rows[0]?.id);
    expect((yield* traced(runs.runById(last.id)))?.id).toBe(last.id);
    expect((yield* traced(runs.runByStartKey(thread.id, 'turn-0')))?.startedAt).toBeDefined();

    const touching = [
      ...new Set(
        spans.flatMap((span) => {
          const text = span.attributes.get('db.query.text');
          return typeof text === 'string' && /\bfrom\s+"thread_run"/i.test(text) ? [text] : [];
        }),
      ),
    ];
    expect(touching.length).toBeGreaterThan(0);
    const db = new Database(path, { readonly: true });
    try {
      const plans = touching.map((query) => {
        const statement = db.query<{ detail: string }, (string | null)[]>(`EXPLAIN QUERY PLAN ${query}`);
        return statement.all(...Array.from({ length: statement.paramsCount }, () => null)).map((step) => step.detail);
      });
      for (const plan of plans) {
        expect(plan.filter((detail) => /\bthread_run\b/.test(detail)).every((detail) => detail.startsWith('SEARCH '))).toBe(true);
        expect(plan.some((detail) => detail.includes('TEMP B-TREE'))).toBe(false);
      }
      expect(plans.flat()).toContain('SEARCH thread_run USING INDEX thread_run_ended_idx (thread_id=? AND (finished_at,id)<(?,?))');
    } finally {
      db.close();
    }
  }),
);
