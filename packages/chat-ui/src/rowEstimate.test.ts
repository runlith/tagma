import type { ToolDisplay } from '@runlith/agent/tool/display';
import { describe, expect, test } from 'vitest';
import type { ActivityRow } from './activity';
import type { ChatEntry } from './entries';
import { markdownHeight, stepEstimate, TextHeights, WELL_LINES } from './rowEstimate';
import { builtinEntryKinds } from './builtinKinds';

const kinds = builtinEntryKinds();

const stretchDefault = (_key: string, newest: boolean) => newest;
const markdown = (_key: string, text: string, columns: number) => markdownHeight(text, columns);
const view = { expanded: (_key: string, fallback: boolean) => fallback, stretchDefault, toolOpen: () => undefined, markdown };
const open = { expanded: (key: string) => !key.endsWith(':all'), stretchDefault, toolOpen: () => undefined, markdown };
const whole = { expanded: () => true, stretchDefault, toolOpen: () => undefined, markdown };

const call = (display: ToolDisplay): ActivityRow => ({
  kind: 'step',
  key: 'tool:1',
  entry: {
    id: 'tool:1',
    kind: 'tool',
    runId: 'run-1',
    toolName: 'read_file',
    toolCallId: 'call-1',
    toolState: 'output-available',
    display,
  } as Extract<ChatEntry, { kind: 'tool' }>,
});

describe('what a markdown body is worth', () => {
  test('a short line is a line, however short', () => {
    const list = ['- one', '- two', '- three', '- four', '- five'].join('\n');
    const sentence = 'one two three four five';

    expect(markdownHeight(list, 78)).toBeGreaterThan(markdownHeight(sentence, 78) * 4);
  });

  test('a heading carries its own air, and a paragraph break is not a line', () => {
    expect(markdownHeight('## a heading', 78)).toBeGreaterThan(markdownHeight('a heading', 78));
    expect(markdownHeight('one\n\ntwo', 78)).toBeLessThan(markdownHeight('one\nmid\ntwo', 78));
  });

  test('fenced lines are counted at the code line box, not the body one', () => {
    const fenced = ['```ts', 'const a = 1;', 'const b = 2;', '```'].join('\n');
    const prose = ['x', 'const a = 1;', 'const b = 2;', 'x'].join('\n');

    expect(markdownHeight(fenced, 78)).toBeLessThan(markdownHeight(prose, 78));
  });

  test("the model's words carry their meta line; a thought does not", () => {
    const text = 'a line of an answer';
    const assistant = kinds.estimate({ id: 'a1', kind: 'assistant', text } as ChatEntry, view);
    const thought = kinds.estimate({ id: 'r1', kind: 'reasoning', text } as ChatEntry, view);

    expect(assistant).toBeGreaterThan(thought);
  });
});

describe('a growing body is priced as the whole text is', () => {
  test('every growth step answers what markdownHeight answers for the text so far', () => {
    const heights = new TextHeights();
    let text = '';
    const pieces = [
      'intro ',
      'line\n',
      '\n',
      '## head',
      'ing\n',
      '```ts\n',
      'const a = 1;\n',
      '```',
      '\n',
      'tail of the prose '.repeat(12),
    ];
    for (const piece of pieces) {
      text += piece;
      expect(heights.markdown('a1', text, 78)).toBe(markdownHeight(text, 78));
    }
    expect(heights.markdown('a1', 'rewritten', 78)).toBe(markdownHeight('rewritten', 78));
  });

  test('a replacement of the same length is priced as the new text, not as growth', () => {
    const heights = new TextHeights();
    expect(heights.markdown('a1', '# h\nsame', 78)).toBe(markdownHeight('# h\nsame', 78));
    expect(heights.markdown('a1', 'aaa\nsame\nmore', 78)).toBe(markdownHeight('aaa\nsame\nmore', 78));
  });
});

describe('what an open call is worth', () => {
  test('an open body is priced by what it carries, a closed one by its line', () => {
    const display = { form: 'code', text: Array.from({ length: 30 }, () => 'const a = 1;').join('\n') } as ToolDisplay;

    const closed = stepEstimate(call(display), false, view);
    const opened = stepEstimate(call(display), false, open);

    expect(closed).toBeLessThan(40);
    expect(opened).toBeGreaterThan(closed + WELL_LINES * 20);
  });

  test('a body taller than its block reserves the ceiling', () => {
    const long = { form: 'code', text: Array.from({ length: 400 }, () => 'x').join('\n') } as ToolDisplay;
    const short = { form: 'code', text: Array.from({ length: 8 }, () => 'x').join('\n') } as ToolDisplay;

    expect(stepEstimate(call(long), false, open)).toBeLessThanOrEqual(428);
    expect(stepEstimate(call(short), false, open)).toBeLessThan(stepEstimate(call(long), false, open));
  });

  test('a body shown whole is priced by all of its lines', () => {
    const long = { form: 'code', text: Array.from({ length: 400 }, () => 'x').join('\n') } as ToolDisplay;

    expect(stepEstimate(call(long), false, whole)).toBeGreaterThan(400 * 20);
  });

  test('a fold that stands open is priced by the rows it opened into', () => {
    const entries = Array.from({ length: 8 }, (_unused, index) => ({
      id: `t${index}`,
      kind: 'tool',
      runId: 'run-1',
      toolName: 'read_block',
      toolCallId: `c${index}`,
      toolState: 'output-available',
    })) as Extract<ChatEntry, { kind: 'tool' }>[];
    const row: ActivityRow = { kind: 'folded', key: 'folded:t0', entries };

    expect(stepEstimate(row, false, open)).toBeGreaterThan(stepEstimate(row, false, view) + 8 * 20);
  });
});
