import { describe, expect, test } from 'bun:test';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES, formatToolOutputRange } from './ToolOutputSpool';

describe('formatToolOutputRange', () => {
  test('keeps every range inside the model byte and line envelope', () => {
    const source = Array.from({ length: 3_000 }, (_, index) => `line-${index}`).join('\n');
    const bytes = new TextEncoder().encode(source);
    const result = formatToolOutputRange({
      outputId: 'output-1',
      requestedOffset: 0,
      totalLength: bytes.byteLength,
      bytes,
    });

    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
    expect(result.split('\n').length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_LINES);
  });

  test('advances from a UTF-8 continuation byte without corrupting text', () => {
    const source = '🙂alpha';
    const bytes = new TextEncoder().encode(source);
    const result = formatToolOutputRange({
      outputId: 'output-1',
      requestedOffset: 1,
      totalLength: bytes.byteLength,
      bytes: bytes.subarray(1),
    });

    expect(result).toStartWith('alpha');
    expect(result).not.toContain('\uFFFD');
  });

  test('reports an offset at or beyond the end without reading content', () => {
    expect(
      formatToolOutputRange({
        outputId: 'output-1',
        requestedOffset: 4,
        totalLength: 4,
        bytes: new Uint8Array(),
      }),
    ).toBe('[End of tool output output-1; 4 bytes total.]');
  });
});
