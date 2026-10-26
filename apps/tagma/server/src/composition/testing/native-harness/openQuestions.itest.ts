import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Tracer } from 'effect';
import { sql } from 'drizzle-orm';
import type { ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { threadQuestionEvent } from '@runlith/agent/thread/events';
import { openThreadStore } from '../storageHarness.js';

it.live('open questions seek the live index and retain prefix and pending-update semantics', () =>
  Effect.gen(function* () {
    const world = yield* openThreadStore();
    const store = world.storage;
    const source = yield* store.createThread({ ownerId: 'owner', scope: 'scope-a' });
    const closed: ThreadQuestionEntry = {
      type: 'question',
      id: 'closed',
      runId: 'run-a',
      questionId: 'closed',
      questions: [],
      toolCalls: [],
      status: 'answered',
      rewound: { by: 'rewind', scope: 'turn' },
    };
    const visible: ThreadQuestionEntry = { ...closed, id: 'visible', questionId: 'visible', status: 'open', rewound: undefined };
    yield* store.aggregate.appendEntries(source.id, { transcript: [closed, visible] });
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    expect(
      (yield* store.aggregate.openQuestionsOfRun(source.id, 'run-a').pipe(Effect.withTracer(tracer))).map((entry) => entry.id),
    ).toEqual(['visible']);
    const queries = [
      ...new Set(
        spans.flatMap((span) => {
          const text = span.attributes.get('db.query.text');
          return typeof text === 'string' && text.includes('indexed by') ? [text] : [];
        }),
      ),
    ];
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      const plan = yield* world.db.all<{ detail: string }>(sql.raw(`explain query plan ${query.replaceAll('?', 'NULL')}`));
      expect(plan.map((step) => step.detail).join('\n')).toContain('USING INDEX thread_entry_open_question_idx');
    }
    const child = yield* store.createThread({ ownerId: 'owner', scope: 'scope-a' });
    yield* store.transitions.writeAt(source.id, (at) =>
      store.aggregate.branch({ sourceId: source.id, childId: child.id, entries: { kind: 'all' }, prompts: 'kept' }, at.tx),
    );
    const reopened = threadQuestionEvent({ ...closed, status: 'open', rewound: undefined });
    yield* store.transitions.writeAt(source.id, (at) =>
      store.eventLog.append({ threadId: source.id, id: 'reopen', kind: reopened.kind, payload: reopened.payload }, at.tx),
    );
    const live = yield* store.aggregate.openQuestionsOfRun(source.id, 'run-a');
    expect(live.map((entry) => entry.id)).toEqual(['closed', 'visible']);
    expect(live[0]?.rewound).toEqual(closed.rewound);
    expect((yield* store.aggregate.openQuestionsOfRun(child.id, 'run-a')).map((entry) => entry.id)).toEqual(['visible']);
    const answered = threadQuestionEvent({ ...visible, status: 'answered' });
    yield* store.transitions.writeAt(source.id, (at) =>
      store.eventLog.append({ threadId: source.id, id: 'answer', kind: answered.kind, payload: answered.payload }, at.tx),
    );
    expect((yield* store.aggregate.openQuestionsOfRun(source.id, 'run-a')).map((entry) => entry.id)).toEqual(['closed']);
  }),
);
