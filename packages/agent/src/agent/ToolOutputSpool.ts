import { utf8ByteLength } from '@runlith/utils/utf8';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const TOOL_OUTPUT_MAX_LINES = 2_000;
export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024;

export type ToolOutputKeep = 'head' | 'tail';

export function countLines(text: string): number {
  let count = 1;
  let index = text.indexOf('\n');
  while (index !== -1) {
    count += 1;
    index = text.indexOf('\n', index + 1);
  }
  return count;
}

export function boundDisplayText(text: string, keep: ToolOutputKeep = 'head'): string {
  const byteLength = utf8ByteLength(text);
  const lineCount = countLines(text);
  if (lineCount <= TOOL_OUTPUT_MAX_LINES && byteLength <= TOOL_OUTPUT_MAX_BYTES) return text;
  return boundedToolOutputPreview(text, `... ${lineCount} lines, ${byteLength} bytes; the rest is not shown ...`, keep);
}

export function boundedToolOutputPreview(text: string, marker?: string, keep: ToolOutputKeep = 'head'): string {
  const markerText = marker ?? '';
  const markerOnly = takePrefix(markerText, TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES);
  const reservedLines = marker ? marker.split('\n').length + 1 : 0;
  const reservedBytes = marker ? utf8ByteLength(marker) + 2 : 0;
  if (TOOL_OUTPUT_MAX_LINES <= reservedLines || TOOL_OUTPUT_MAX_BYTES <= reservedBytes) return markerOnly;

  const lineLimit = TOOL_OUTPUT_MAX_LINES - reservedLines;
  const byteLimit = TOOL_OUTPUT_MAX_BYTES - reservedBytes;
  const preview = decoder.decode(
    encoder.encode(keep === 'tail' ? takeSuffix(text, byteLimit, lineLimit) : takePrefix(text, byteLimit, lineLimit)),
  );
  if (!marker) return preview;
  if (keep === 'tail') return preview ? `${marker}\n\n${preview}` : markerOnly;
  return preview ? `${preview}\n\n${marker}` : markerOnly;
}

export function retentionFailure(
  preview: string,
  error: unknown,
): {
  readonly diagnostic: string;
  readonly preview: string;
} {
  const diagnostic = error instanceof Error && error.name ? error.name : 'UnknownError';
  return {
    diagnostic,
    preview: boundedToolOutputPreview(
      preview,
      [
        `Tool execution completed, but its complete output could not be retained (${diagnostic}).`,
        'MUST NOT rerun the tool solely to recover this output. Continue using the bounded preview.',
      ].join('\n'),
    ),
  };
}

export function formatToolOutputRange(input: {
  readonly outputId: string;
  readonly requestedOffset: number;
  readonly totalLength: number;
  readonly bytes: Uint8Array;
}): string {
  if (input.requestedOffset >= input.totalLength) {
    return `[End of tool output ${input.outputId}; ${input.totalLength} bytes total.]`;
  }
  let start = 0;
  while (start < input.bytes.byteLength && input.requestedOffset + start > 0 && ((input.bytes[start] as number) & 0xc0) === 0x80) {
    start += 1;
  }
  const offset = input.requestedOffset + start;
  const longestStatus = `[Showing bytes ${offset}-${input.totalLength} of ${input.totalLength}. Continue with offset ${input.totalLength}.]`;
  const byteBudget = TOOL_OUTPUT_MAX_BYTES - utf8ByteLength(longestStatus) - 2;
  let end = Math.min(input.bytes.byteLength, start + byteBudget);
  let lines = 1;
  for (let index = start; index < end; index += 1) {
    if (input.bytes[index] !== 0x0a) continue;
    lines += 1;
    if (lines >= TOOL_OUTPUT_MAX_LINES - 1) {
      end = index;
      break;
    }
  }
  while (end > start && input.requestedOffset + end < input.totalLength && ((input.bytes[end] as number) & 0xc0) === 0x80) {
    end -= 1;
  }
  const absoluteEnd = input.requestedOffset + end;
  const content = decoder.decode(input.bytes.subarray(start, end));
  const status =
    absoluteEnd < input.totalLength
      ? `[Showing bytes ${offset}-${absoluteEnd} of ${input.totalLength}. Continue with offset ${absoluteEnd}.]`
      : `[Showing bytes ${offset}-${absoluteEnd} of ${input.totalLength}. End of output.]`;
  return content ? `${content}\n\n${status}` : status;
}

function takeSuffix(text: string, maximumBytes: number, maximumLines: number): string {
  if (maximumBytes <= 0 || maximumLines <= 0 || text.length === 0) return '';
  const lines = text.split('\n');
  const kept: string[] = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0 && kept.length < maximumLines; index -= 1) {
    const line = lines[index] as string;
    const size = utf8ByteLength(line) + (kept.length > 0 ? 1 : 0);
    if (bytes + size > maximumBytes) {
      if (kept.length === 0) kept.unshift(takeByteSuffix(line, maximumBytes));
      break;
    }
    kept.unshift(line);
    bytes += size;
  }
  return kept.join('\n');
}

function takeByteSuffix(line: string, maximumBytes: number): string {
  const bytes = encoder.encode(line);
  if (bytes.byteLength <= maximumBytes) return line;
  let start = bytes.byteLength - maximumBytes;
  while (start < bytes.byteLength && ((bytes[start] as number) & 0xc0) === 0x80) start += 1;
  return decoder.decode(bytes.subarray(start));
}

function takePrefix(text: string, maximumBytes: number, maximumLines: number): string {
  if (maximumBytes <= 0 || maximumLines <= 0 || text.length === 0) return '';
  const bytes = new Uint8Array(maximumBytes);
  const { read, written } = new TextEncoder().encodeInto(text, bytes);
  const byteBounded = read === text.length ? text : new TextDecoder().decode(bytes.subarray(0, written));
  let lines = 1;
  for (let index = 0; index < byteBounded.length; index += 1) {
    if (byteBounded[index] !== '\n') continue;
    lines += 1;
    if (lines > maximumLines) return byteBounded.slice(0, index);
  }
  return byteBounded;
}
