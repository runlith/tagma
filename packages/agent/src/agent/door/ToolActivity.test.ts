import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { ActivityLog } from '@runlith/activity/log';
import type { ActivityOutcome } from '@runlith/activity/fact';
import { activityRecording } from '@runlith/activity/testing';
import { Effect, Schema } from 'effect';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import { Tool, ToolAnswer, type ToolAnswerOptions } from '../tool';
import { call, open } from './testing/open';
it.effect(
  'tool activity preserves a returned refusal even when the tool executed successfully',
  Effect.fnUntraced(function* () {
    const recording = activityRecording();
    const refusal = { code: 'status-operation', reason: 'This transition belongs to finish_block.' };
    const refused = Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Apply the transition.',
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed(new ToolAnswer({ status: 'refused', ...refusal }, { form: 'text', text: refusal.reason }, { refusal })),
    });
    const { door } = open();
    const outcome = yield* door.settle(call(refused)).pipe(Effect.provideService(ActivityLog, recording.log));
    expect(outcome.executed).toBe(true);
    expect(outcome.verdict).toEqual({ kind: 'refused', refusal });
    expect(recording.activities().find((entry) => entry.opened.kind === 'tool-call')?.ended).toMatchObject({
      outcome: 'refused',
      reason: refusal.code,
      message: refusal.reason,
    });
  }),
);
it.effect('a returned execution failure keeps its output and records failed activity', () =>
  Effect.gen(function* () {
    const recording = activityRecording();
    const tool = Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Execute a check.',
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed(new ToolAnswer('compiler diagnostics', undefined, { failure: 'Exited with code 3.' })),
    });
    const result = yield* open().door.settle(call(tool)).pipe(Effect.provideService(ActivityLog, recording.log));
    expect(result).toMatchObject({
      executed: true,
      output: 'compiler diagnostics',
      verdict: { kind: 'failed', error: 'Exited with code 3.' },
    });
    expect(recording.activities().find((entry) => entry.opened.kind === 'tool-call')?.ended).toMatchObject({
      outcome: 'failed',
      message: 'Exited with code 3.',
    });
  }),
);

it.effect(
  'a call whose display projection breaks still runs, and the break is recorded as a degradation',
  Effect.fnUntraced(function* () {
    const recording = activityRecording();
    const tool = Tool.make({
      display: () => {
        throw new TypeError('no title');
      },
      approval: ASKS_NEVER,
      description: 'Read the result.',
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed(new ToolAnswer({ result: 'done' }, { form: 'none' })),
    });
    const result = yield* open().door.settle(call(tool)).pipe(Effect.provideService(ActivityLog, recording.log));
    expect(result.executed).toBe(true);
    expect(result.verdict).toEqual({ kind: 'answered' });
    const notes = recording.activities().flatMap((entry) => entry.notes);
    expect(notes.filter((note) => note.type === 'degraded')).toMatchObject([{ place: 'tool preview', message: 'no title' }]);
  }),
);
it.effect(
  'a tool whose work dies answers with its failure, and the defect is recorded once with its stack',
  Effect.fnUntraced(function* () {
    const recording = activityRecording();
    const tool = Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Break.',
      parameters: Schema.Struct({}),
      execute: () => Effect.die(new TypeError('row 7 broke')),
    });
    const result = yield* Effect.exit(open().door.settle(call(tool)).pipe(Effect.provideService(ActivityLog, recording.log)));
    expect(result._tag).toBe('Failure');
    const defects = recording.activities().flatMap((entry) => entry.notes.filter((note) => note.type === 'defect'));
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatchObject({ message: 'row 7 broke' });
    expect(String(defects[0]?.stack)).toContain('TypeError: row 7 broke');
  }),
);
for (const [options, outcome] of [
  [{}, 'ok'],
  [{ ending: 'cancelled' }, 'cancelled'],
  [{ ending: 'unknown' }, 'failed'],
] satisfies readonly (readonly [ToolAnswerOptions, ActivityOutcome])[]) {
  it.effect(
    `tool activity records a returned ${outcome} verdict independently of execution`,
    Effect.fnUntraced(function* () {
      const recording = activityRecording();
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Read the result.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed(new ToolAnswer({ result: 'done' }, { form: 'none' }, options)),
      });
      const result = yield* open().door.settle(call(tool)).pipe(Effect.provideService(ActivityLog, recording.log));
      expect(result.executed).toBe(true);
      expect(recording.activities().find((entry) => entry.opened.kind === 'tool-call')?.ended?.outcome).toBe(outcome);
    }),
  );
}
