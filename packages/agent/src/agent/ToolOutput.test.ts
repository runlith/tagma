import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from './ToolOutputSpool';
import {
  initialToolDisplay,
  boundAgentToolOutput,
  failedAgentToolOutputRetention,
  inspectAgentToolOutput,
  unretainedAgentToolOutput,
  projectToolResultMessages,
} from './ToolOutput';
import { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { Effect } from 'effect';
describe('agent tool output projection', () => {
  it.effect(
    'rebounding preserves unchanged history identities and replaces only the changed result',
    Effect.fnUntraced(function* () {
      const unchanged = ToolResultPart.from({ id: 'kept', name: 'read', result: { type: 'text', value: 'kept' } });
      const oversized = ToolResultPart.from({ id: 'cut', name: 'read', result: { type: 'text', value: 'full output' } });
      const assistant = Message.assistant('answer');
      const kept = Message.tool(unchanged);
      const cut = Message.assistant([unchanged, oversized]);
      const replacement = { type: 'text', value: 'bounded output' } as const;
      const projected = yield* projectToolResultMessages([assistant, kept, cut], (input) =>
        Effect.succeed({ output: input.output, modelOutput: input.toolCallId === 'cut' ? replacement : input.modelOutput }),
      );
      expect(projected[0]).toBe(assistant);
      expect(projected[1]).toBe(kept);
      expect(projected[2]?.content[0]).toBe(cut.content[0]);
      expect(projected[2]?.content[1]).toEqual({ ...oversized, result: replacement });
      expect(cut.content[1]).toEqual(oversized);
    }),
  );
  test('keeps values at both OpenCode boundaries unchanged', () => {
    const text = Array.from({ length: TOOL_OUTPUT_MAX_LINES }, () => 'x').join('\n');
    const inspection = inspectAgentToolOutput({ type: 'text', value: text });
    expect(inspection.lineCount).toBe(TOOL_OUTPUT_MAX_LINES);
    expect(inspection.oversized).toBe(false);
  });
  test('counts lines across ASCII, CRLF, and astral text', () => {
    const inputs = ['', 'ASCII', 'first\nsecond', '\n', 'first\r\nsecond\r\n', 'before🙂after\n𠮷\nend'] as const;
    for (const text of inputs) {
      expect(inspectAgentToolOutput({ type: 'text', value: text }).lineCount).toBe(text.split('\n').length);
    }
  });
  test('bounds the complete model-visible envelope in UTF-8 bytes and lines', () => {
    const tail = 'UNIQUE_TOOL_OUTPUT_TAIL';
    const line = '🙂'.repeat(Math.ceil(TOOL_OUTPUT_MAX_BYTES / TOOL_OUTPUT_MAX_LINES / 4));
    const full = [...Array.from({ length: TOOL_OUTPUT_MAX_LINES }, () => line), tail].join('\n');
    const inspection = inspectAgentToolOutput({ type: 'text', value: full });
    const projection = boundAgentToolOutput(
      { type: 'text', value: full },
      {
        outputId: 'output-1',
        byteLength: inspection.byteLength,
        lineCount: inspection.lineCount,
        retrievalTool: 'fetch_full_output',
      },
    );
    const value = projection.modelOutput.type === 'text' ? String(projection.modelOutput.value) : '';
    expect(inspection.oversized).toBe(true);
    expect(value).toContain('fetch_full_output');
    expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
    expect(value.split('\n').length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_LINES);
    expect(value).toContain('output-1');
    expect(value).not.toContain(tail);
    expect(value.startsWith('🙂')).toBe(true);
  });
  test('a tail-kept output loses its beginning and keeps the words that end it', () => {
    const lines = Array.from({ length: TOOL_OUTPUT_MAX_LINES }, (_, index) => `line ${index}`);
    const full = [...lines, 'FAILED: 3 of 900 tests'].join('\n');
    const bounded = boundAgentToolOutput(
      { type: 'text', value: full },
      { outputId: 'output-1', byteLength: 1, lineCount: lines.length + 1, retrievalTool: 'read_tool_output', keep: 'tail' },
    );
    const value = bounded.modelOutput.type === 'text' ? String(bounded.modelOutput.value) : '';
    expect(value).toContain('FAILED: 3 of 900 tests');
    expect(value).not.toContain('line 0\n');
  });
  test('bounds an input-derived command form from the end its tool declared', () => {
    const command = Array.from({ length: TOOL_OUTPUT_MAX_LINES + 1 }, (_, index) => `echo ${index}`).join('\n');
    const display = initialToolDisplay({
      declared: { form: 'command', title: 'Run commands', command },
      mutates: true,
      keep: 'tail',
    });
    expect(display.form).toBe('command');
    if (display.form !== 'command') throw new Error('the form must stay a command');
    expect(display.command.split('\n').length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_LINES);
    expect(display.command).toContain(`echo ${TOOL_OUTPUT_MAX_LINES}`);
    expect(display.command).not.toContain('echo 0\n');
    expect(display.mutates).toBe(true);
  });
  test('an unretained oversized output is bounded', () => {
    const full = Array.from({ length: TOOL_OUTPUT_MAX_LINES + 1 }, (_, index) => `line ${index}`).join('\n');
    const bounded = unretainedAgentToolOutput(full, { type: 'text', value: full }, 'head');
    const value = bounded.modelOutput.type === 'text' ? String(bounded.modelOutput.value) : '';
    expect(value.split('\n').length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_LINES);
    expect(unretainedAgentToolOutput('small', { type: 'text', value: 'small' }, 'head').output).toBe('small');
  });
  test('reports post-execution retention failure without turning it into a rerunnable tool error', () => {
    const failure = new Error('sensitive storage response body');
    failure.name = 'StorageWriteError';
    const projection = failedAgentToolOutputRetention({
      toolName: 'expensive_side_effect',
      toolCallId: 'call-1',
      output: 'x'.repeat(TOOL_OUTPUT_MAX_BYTES * 2),
      error: failure,
    });
    const output = projection.output as {
      toolCompleted: boolean;
      retained: boolean;
      diagnostic: string;
      preview: string;
    };
    expect(output.toolCompleted).toBe(true);
    expect(output.retained).toBe(false);
    expect(output.diagnostic).toBe('StorageWriteError');
    expect(projection.modelOutput.type).toBe('text');
    expect(Buffer.byteLength(output.preview, 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
    expect(JSON.stringify(projection)).not.toContain(failure.message);
  });
});
