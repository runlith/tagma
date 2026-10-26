import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { Tool } from './tool';
import { toolArguments } from './ToolArguments';
import { ASKS_NEVER } from '../permissions/vocabulary';
const bash = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Run a command.',
  parameters: Schema.Struct({
    command: Schema.String,
    timeout: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    background: Schema.optional(Schema.Boolean),
    produces: Schema.optional(Schema.Array(Schema.String)),
  }),
});
const waitFor = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Wait for agents.',
  parameters: Schema.Struct({ from: Schema.Array(Schema.String) }),
});
const readPerformance = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Read performance.',
  parameters: Schema.Struct({
    type: Schema.Literals(['span', 'breakdown']),
    name: Schema.String,
    limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  }),
});
const search = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Search.',
  parameters: Schema.Struct({ query: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }),
});
describe('the dialect a model writes is read after the codec refuses', () => {
  it.effect(
    'quoted numbers, booleans and lone list elements follow the declared schema',
    Effect.fnUntraced(function* () {
      expect(yield* toolArguments(bash, 'bash', { command: 'ls', timeout: '600000' })).toEqual({ command: 'ls', timeout: 600000 });
      expect(yield* toolArguments(readPerformance, 'read_performance', { type: 'span', name: 'x', limit: '50' })).toEqual({
        type: 'span',
        name: 'x',
        limit: 50,
      });
      for (const [written, meant] of [
        ['True', true],
        ['true', true],
        ['False', false],
        ['false', false],
      ] as const) {
        expect(yield* toolArguments(bash, 'bash', { command: 'ls', background: written })).toEqual({ command: 'ls', background: meant });
      }
      expect(yield* toolArguments(waitFor, 'wait_for', { from: 'bench3-probe' })).toEqual({ from: ['bench3-probe'] });
      expect(yield* toolArguments(bash, 'bash', { command: 'ls', produces: 'out.txt' })).toEqual({ command: 'ls', produces: ['out.txt'] });
    }),
  );
  it.effect(
    'JSON text of a list is read as its elements rather than one string element',
    Effect.fnUntraced(function* () {
      expect(yield* toolArguments(waitFor, 'wait_for', { from: '["lead","worker"]' })).toEqual({ from: ['lead', 'worker'] });
    }),
  );
  it.effect(
    'optional null is omitted and a declared string stays a string',
    Effect.fnUntraced(function* () {
      expect(yield* toolArguments(bash, 'bash', { command: 'ls', timeout: null, background: null })).toEqual({ command: 'ls' });
      expect(yield* toolArguments(search, 'search_blocks', { query: 'gate' })).toEqual({ query: 'gate' });
      expect(yield* toolArguments(search, 'search_blocks', { query: '["gate"]' })).toEqual({ query: '["gate"]' });
    }),
  );
  it.effect(
    'unsupported spellings and out-of-range repairs retain the original refusal data',
    Effect.fnUntraced(function* () {
      for (const [argument, value] of [
        ['timeout', 'soon'],
        ['background', '1'],
        ['background', 'yes'],
        ['timeout', '0'],
      ] as const) {
        expect(yield* Effect.flip(toolArguments(bash, 'bash', { command: 'ls', [argument]: value }))).toMatchObject({
          _tag: 'Tool.ArgumentsInvalid',
          code: 'body-shape',
          argument,
          sent: `the string "${value}"`,
        });
      }
      expect(yield* Effect.flip(toolArguments(waitFor, 'wait_for', { from: null }))).toMatchObject({ argument: 'from', sent: 'null' });
      expect(yield* Effect.flip(toolArguments(bash, 'bash', { command: 7, timeout: '600000' }))).toMatchObject({
        argument: 'command',
        expected: 'a string',
        sent: '7',
      });
    }),
  );
});
