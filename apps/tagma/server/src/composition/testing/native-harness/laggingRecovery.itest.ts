import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { makeThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { SCOPED_RUN, threadHistory, threadRunStore } from '../../../native-harness/testing/doubles.js';
import { journalSteps } from '../../../threads/testing/doubles.js';
import { threadStack } from '../threadParts.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

const recovery: ThreadFormStep = {
  name: '20261010170000_recovery_words',
  samples: { entry: { type: 'message', when: 'then' }, message: { role: 'user', content: 'before' } },
  entry: (entry) => {
    if (entry.type !== 'message' || entry.when === undefined) return null;
    const { when, ...rest } = entry;
    return { ...rest, occurredAt: when };
  },
  message: (message) => (typeof message.content === 'string' ? { ...message, content: [{ type: 'text', text: message.content }] } : null),
};

const kinds = makeThreadEntryReader({ products: [], steps: journalSteps([[recovery]]) });
const progress = { stage: null, message: null } as const;

it.live(
  'recovery adopting the running turn of a thread whose mark lags hands over its tail and its history in the current shape',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { db, units, records, context } = demo;
    const stack = yield* Effect.provide(threadStack({ db, units, records, kinds }), context);
    const history = yield* Effect.provide(threadHistory(kinds), context);
    const runs = (ownerId: string) => Effect.provide(threadRunStore({ kinds, records, ownerId, scope: SCOPED_RUN() }), context);
    const threadId = yield* units
      .write('testing.laggingThread', (unit) =>
        Effect.gen(function* () {
          const born = yield* stack.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* stack.threads.rows.attachFacet({ threadId: born.id, projectId: demo.projectId }, unit);
          return born.id;
        }),
      )
      .pipe(Effect.orDie);
    const crashed = yield* runs('dead-owner');
    const { run } = yield* crashed
      .createRun({
        startFrom: {
          id: threadId,
          ownerId: 'operator',
          account: null,
          provider: 'openai-oauth',
          model: 'test',
          reasoning: null,
          switches: {},
        },
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress,
      })
      .pipe(Effect.orDie);
    const old = { type: 'message', id: 'said', runId: run.id, role: 'assistant', text: 'partial', when: 'then' };
    yield* db.run(sql`update thread_run set stream_tail = json_array(json(${JSON.stringify(old)})) where id = ${run.id}`);
    yield* db.run(sql`update thread_rollout_form set step = null where thread_id = ${threadId}`);
    yield* db.run(
      sql`insert into thread_log (thread_id, history_through, entries_through) values (${threadId}, 0, 0)
        on conflict (thread_id) do update set history_through = 0, entries_through = 0`,
    );
    yield* db.run(
      sql`insert into thread_history_item (thread_id, ord, message) values (${threadId}, 0, ${JSON.stringify({ role: 'user', content: 'before' })})`,
    );
    yield* crashed.handOverRuns([run.id], new Date('2026-02-01T00:00:00.000Z')).pipe(Effect.orDie);

    const adopted = yield* (yield* runs('successor-owner'))
      .adoptRun(run.id, {
        selector: { kind: 'handed-over' },
        maxResumes: 3,
        progress,
        heartbeatAt: new Date('2026-02-01T00:00:01.000Z'),
      })
      .pipe(Effect.orDie);

    const { when, ...rest } = old;
    expect(adopted?.streamTail).toEqual([{ ...rest, occurredAt: when }]);
    expect(yield* units.read((unit) => history.read(unit, threadId)).pipe(Effect.orDie)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'before' }] },
    ]);
  }),
);
