import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { agentRule } from '../policy/AgentRuntimePolicy';
import { Tool } from '../tool';
import { call, countingTool, type Ctx, open, WRITES_ONE_FILE } from './testing/open';
import { ASKS_IN_REVIEW } from '../../permissions/vocabulary';
describe('ToolExecution outcome', () => {
  it.effect(
    'the after-hook publishes its call context and contributes its awaited work to the duration',
    Effect.fnUntraced(function* () {
      const { door, guides } = open({
        rules: [
          agentRule<Ctx>(
            'speak-plainly',
            (ctx) =>
              ctx.hook === 'afterTool' ? Effect.as(TestClock.adjust(75), { type: 'guide', text: 'Say it plainly.' } as const) : null,
            { owner: 'test' },
          ),
        ],
      });
      const outcome = yield* door.settle(
        call(
          countingTool(() => undefined),
          { toolCallId: 'call-7' },
        ),
      );
      expect(guides).toContainEqual({
        directives: [expect.objectContaining({ type: 'guide', ruleId: 'speak-plainly' })],
        context: { hook: 'afterTool', toolName: 'side_effect', toolCallId: 'call-7' },
      });
      expect(outcome.durationMs).toBe(75);
      expect(outcome.display.durationMs).toBe(75);
    }),
  );
  it.effect(
    'a door nobody stands behind refuses an ask, naming the rule that asked',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const { door } = open({ mode: 'review', unattended: true });
      const outcome = yield* door.settle(
        call(
          countingTool(() => {
            runs += 1;
          }),
          { declares: WRITES_ONE_FILE },
        ),
      );
      expect(runs).toBe(0);
      expect(outcome.executed).toBe(false);
      expect(outcome.output).toMatchObject({ status: 'refused', code: 'no-approver' });
    }),
  );
});
describe('the step a call is handed', () => {
  it.effect(
    'a confirmed call runs under the step its door was opened at, not the first step of the run',
    Effect.fnUntraced(function* () {
      const { door } = open({ mode: 'review', stepsTaken: 4 });
      const seen: (number | undefined)[] = [];
      const write = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Write the note.',
        parameters: Schema.Struct({ text: Schema.String }),
        mutates: true,
        confirmation: WRITES_ONE_FILE.confirmation,
        subjects: () => [{ kind: 'write' as const, value: 'notes/today.md' }],
        execute: (_input, call) =>
          Effect.sync(() => {
            seen.push(call.step);
            return { written: true };
          }),
      });
      yield* door.settle({
        name: 'write',
        tool: write,
        input: { text: 'hello' },
        confirmed: true,
        options: { toolCallId: 'call-1', messages: [] },
      });
      expect(seen).toEqual([4]);
    }),
  );
});
