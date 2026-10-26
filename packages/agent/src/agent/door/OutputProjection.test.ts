import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import type { ToolDisplay } from '../../tool/display';
import { Tool } from '../tool';
import type { AgentToolOutputs } from '../ToolOutput';
import { AgentHostFailed } from '../AgentFailure';
import { call, countingTool, open, WRITES_ONE_FILE } from './testing/open';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../permissions/vocabulary';
describe('OutputProjection', () => {
  it.effect(
    'a tool that ran keeps its effect when retention fails, and says so',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const { door } = open({
        toolOutputs: {
          project: () => Effect.fail(new AgentHostFailed({ port: 'toolOutputs', cause: new Error('retention failed') })),
          projectMessages: (messages) => Effect.succeed(messages),
        },
      });
      const outcome = yield* door.settle(
        call(
          countingTool(() => {
            runs += 1;
          }),
        ),
      );
      expect(runs).toBe(1);
      expect(outcome.executed).toBe(true);
      expect(outcome.output).toMatchObject({ toolCompleted: true, retained: false, truncated: true });
    }),
  );
  it.effect(
    'a refused call is projected by the door, never through the tool’s own model grammar',
    Effect.fnUntraced(function* () {
      let projected = 0;
      const strict = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer in this catalog’s own shape.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed({ status: 'ok' as const, rows: ['one'] }),
        toModelOutput: ({ output }) => {
          projected += 1;
          const answer = output as {
            status: string;
            rows: readonly string[];
          };
          return { type: 'text', value: `${answer.status}: ${answer.rows.join(', ')}` };
        },
      });
      const { door } = open({ mode: 'review', unattended: true });
      const outcome = yield* door.settle(call(strict, { declares: WRITES_ONE_FILE }));
      expect(projected).toBe(0);
      expect(outcome.executed).toBe(false);
      expect(outcome.output).toMatchObject({ status: 'refused', code: 'no-approver' });
      expect(outcome.modelOutput).toMatchObject({ type: 'text', value: expect.stringMatching(/^refused\[no-approver\]: /u) });
    }),
  );
});
describe('a picture a tool answers', () => {
  const LOCATION = '/api/threads/thread-1/attachments/shot.png';
  const picturing = Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Answer one picture.',
    parameters: Schema.Struct({}),
    execute: () =>
      Effect.succeed(
        new Tool.ToolAnswer(
          'screen.png',
          { form: 'none', title: 'screen.png' },
          {
            media: [{ bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png', label: 'screen.png' }],
          },
        ),
      ),
  });
  const outputs = (keepPicture?: AgentToolOutputs['keepPicture']): AgentToolOutputs => ({
    project: (input) => Effect.succeed({ output: input.output, modelOutput: input.modelOutput }),
    projectMessages: (messages) => Effect.succeed(messages),
    keepPicture,
  });
  it.effect(
    'a kept picture reaches the model and reader; refusal, failure or no keeper leave words alone',
    Effect.fnUntraced(function* () {
      const kept = { location: LOCATION, mediaType: 'image/png', width: 1000, height: 500, sourceWidth: 2000, sourceHeight: 1000 };
      const { door } = open({ toolOutputs: outputs(() => Effect.succeed({ kept })) });
      const outcome = yield* door.settle(call(picturing));
      if (outcome.modelOutput.type !== 'content') return yield* Effect.die('a kept picture must ride the content arm');
      const [said, picture] = outcome.modelOutput.value;
      expect(said?.type === 'text' && said.text.startsWith('screen.png')).toBe(true);
      expect(picture).toEqual({ type: 'file', uri: LOCATION, mime: 'image/png', name: 'screen.png', width: 1000, height: 500 });
      expect(outcome.display.images).toEqual([{ url: LOCATION, mediaType: 'image/png', width: 1000, height: 500, label: 'screen.png' }]);
      const keepers: (AgentToolOutputs['keepPicture'] | undefined)[] = [
        () => Effect.succeed({ refused: 'it is larger than allowed' }),
        () => Effect.fail(new AgentHostFailed({ port: 'toolOutputs', cause: new Error('disk full') })),
        undefined,
      ];
      for (const keepPicture of keepers) {
        const outcome = yield* open({ toolOutputs: outputs(keepPicture) }).door.settle(call(picturing));
        expect(outcome.executed).toBe(true);
        expect(outcome.modelOutput.type).toBe('text');
        expect(outcome.display.images).toBeUndefined();
      }
    }),
  );
});
describe('the display a call settles with', () => {
  const settle = (tool: Tool, input: unknown = {}) =>
    open().door.settle({ name: 'answering', tool, input, options: { toolCallId: 'call-1', messages: [] } });
  const declaredForm = (display: ToolDisplay) => {
    const { durationMs: _durationMs, ...declared } = display;
    return declared;
  };
  it.effect(
    'an undeclared form uses model-visible text, while a declared form arrives whole with its value unwrapped',
    Effect.fnUntraced(function* () {
      const plain = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer in text.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed('two files matched'),
      });
      const plainOutcome = yield* settle(plain);
      expect(declaredForm(plainOutcome.display)).toEqual({ form: 'text', text: 'two files matched' });
      expect(plainOutcome.display.durationMs).toBeGreaterThanOrEqual(0);
      const listing = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Answer with a list.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.succeed(
            new Tool.ToolAnswer('a.ts\nb.ts', {
              form: 'list',
              title: '*.ts',
              items: [{ label: 'a.ts' }, { label: 'b.ts' }],
              facts: [{ label: 'files', value: '2' }],
            }),
          ),
      });
      const outcome = yield* settle(listing);
      expect(outcome.output).toBe('a.ts\nb.ts');
      expect(outcome.modelOutput).toEqual({ type: 'text', value: 'a.ts\nb.ts' });
      expect(declaredForm(outcome.display)).toEqual({
        form: 'list',
        title: '*.ts',
        items: [{ label: 'a.ts' }, { label: 'b.ts' }],
        facts: [{ label: 'files', value: '2' }],
      });
    }),
  );
  it.effect(
    'a tool that changes something says so on its form, whatever it declared',
    Effect.fnUntraced(function* () {
      const writes = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Change a file.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed(new Tool.ToolAnswer('done', { form: 'text', text: 'done' })),
        mutates: true,
        confirmation: { prompt: () => ({ summary: 'Write it?' }), confirmLabel: 'Write' },
      });
      expect(declaredForm((yield* settle(writes)).display)).toEqual({ form: 'text', text: 'done', mutates: true });
    }),
  );
  it.effect(
    'a body with no form keeps its call’s subject, and a settled form drops its waiting budget',
    Effect.fnUntraced(function* () {
      const naming = Tool.make({
        approval: ASKS_NEVER,
        description: 'Load a thing by name.',
        parameters: Schema.Struct({ thing: Schema.String }),
        display: ({ thing }) => ({ form: 'none', title: thing, facts: [{ label: 'kind', value: 'skill' }] }),
        execute: () => Effect.succeed('the body the model reads'),
      });
      expect(declaredForm((yield* settle(naming, { thing: 'tagma' })).display)).toEqual({
        form: 'text',
        title: 'tagma',
        facts: [{ label: 'kind', value: 'skill' }],
        text: 'the body the model reads',
      });
      const parking = Tool.make({
        approval: ASKS_NEVER,
        description: 'Wait for somebody.',
        parameters: Schema.Struct({}),
        display: () => ({ form: 'none', title: 'critic', awaitsMs: 30_000 }),
        execute: () => Effect.succeed('nobody answered'),
      });
      const display = (yield* settle(parking)).display;
      expect(display.title).toBe('critic');
      expect(display.awaitsMs).toBeUndefined();
    }),
  );
  it.effect(
    'a refused call still answers a form: the reader is told what the refusal said',
    Effect.fnUntraced(function* () {
      const denied = Tool.make({
        approval: ASKS_IN_REVIEW,
        description: 'Change a file.',
        parameters: Schema.Struct({}),
        display: () => ({ form: 'none', title: 'the ledger' }),
        execute: () => Effect.succeed('never runs'),
        mutates: true,
        confirmation: { prompt: () => ({ summary: 'Write it?' }), confirmLabel: 'Write' },
      });
      const outcome = yield* open({ mode: 'review', unattended: true }).door.settle({
        name: 'answering',
        tool: denied,
        input: {},
        options: { toolCallId: 'call-2', messages: [] },
      });
      expect(outcome.executed).toBe(false);
      expect(outcome.display.form).toBe('text');
      expect(outcome.display.mutates).toBe(true);
      expect(outcome.display.title).toBe('the ledger');
    }),
  );
});
