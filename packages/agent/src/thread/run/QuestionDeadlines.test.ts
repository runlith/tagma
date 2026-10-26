import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { QuestionDeadlines, questionDeadlinesLayer } from './QuestionDeadlines';
const WITHIN = 50_000;
layer(questionDeadlinesLayer)('QuestionDeadlines', (it) => {
  it.effect(
    'a deadline fires exactly when its window passes and not before',
    Effect.fnUntraced(function* () {
      const deadlines = yield* QuestionDeadlines;
      const fired: string[] = [];
      deadlines.arm(
        { runId: 'r', questionId: 'q', withinMs: WITHIN },
        Effect.sync(() => void fired.push('q')),
      );
      yield* TestClock.adjust(WITHIN - 1);
      expect(fired).toEqual([]);
      yield* TestClock.adjust(1);
      expect(fired).toEqual(['q']);
    }),
  );
  it.effect(
    'a deadline counts from when the question was asked',
    Effect.fnUntraced(function* () {
      const deadlines = yield* QuestionDeadlines;
      const fired: string[] = [];
      const askedAt = new Date((yield* Clock.currentTimeMillis) - 20_000).toISOString();
      deadlines.arm(
        { runId: 'r', questionId: 'q', withinMs: WITHIN, askedAt },
        Effect.sync(() => void fired.push('q')),
      );
      yield* TestClock.adjust(WITHIN - 20_001);
      expect(fired).toEqual([]);
      yield* TestClock.adjust(1);
      expect(fired).toEqual(['q']);
    }),
  );
  it.effect(
    'a disarmed deadline never fires, and disarming a run takes all of its questions',
    Effect.fnUntraced(function* () {
      const deadlines = yield* QuestionDeadlines;
      const fired: string[] = [];
      const arm = (runId: string, questionId: string) =>
        deadlines.arm(
          { runId, questionId, withinMs: WITHIN },
          Effect.sync(() => void fired.push(questionId)),
        );
      arm('r', 'a');
      arm('r', 'b');
      arm('other', 'c');
      deadlines.disarm('r', 'a');
      deadlines.disarm('r');
      yield* TestClock.adjust(WITHIN);
      expect(fired).toEqual(['c']);
    }),
  );
});
