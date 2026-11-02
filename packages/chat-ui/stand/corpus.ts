import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ObservedEntries } from './recording';

export const ENTRY_COUNT = 10_000;
export const PAGE_SIZE = 120;
export const STREAM_ID = 'stream-answer';
export const STREAM_RUN = 'stream-run';
export const entryId = (index: number): string => `entry-${String(index).padStart(5, '0')}`;
export const userLabel = (index: number): string => `Message ${String(index / 5).padStart(4, '0')}`;

const paragraph =
  'A reader keeps their place while the conversation grows. Older history arrives over a distant connection, with different line lengths, inline `code`, **strong words**, and links. The native list must preserve the text under the reader’s eye.';
const code =
  '```typescript\n' +
  Array.from({ length: 12 }, (_, line) => `const item${line} = { key: ${line}, text: "a line whose width can change" };`).join('\n') +
  '\n```';
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#202020"/><path d="M0 210L180 40L350 160L500 60L640 180" fill="none" stroke="#999" stroke-width="4"/></svg>')}`;

export function markdown(index: number): string {
  const paragraphs = Array.from({ length: 2 + ((index * 7) % 9) }, (_, part) => `Paragraph ${part + 1}. ${paragraph}`).join('\n\n');
  const extras =
    index % 3 === 0
      ? `\n\n${code}`
      : index % 3 === 1
        ? '\n\n| Place | Measured | Changed |\n| --- | --- | --- |\n| Above | 120 | 180 |\n| At | 240 | 240 |\n| Below | 80 | 320 |'
        : '\n\n- First item\n- Second item with a longer line\n  - Nested item\n\n> A quote at the end of a long answer.';
  return `## Answer ${index}\n\n${paragraphs}${extras}`;
}

export function corpus(count = ENTRY_COUNT): readonly ThreadTranscriptEntry[] {
  return Array.from({ length: count }, (_, index): ThreadTranscriptEntry => {
    const id = entryId(index);
    const runId = `run-${Math.floor(index / 5)}`;
    const occurredAt = '2026-01-01T00:00:00.000Z';
    if (index % 5 === 0)
      return {
        type: 'message',
        role: 'user',
        id,
        runId,
        occurredAt,
        text: `${userLabel(index)}: inspect the next part of this conversation.`,
      };
    if (index % 5 === 2) {
      const output = Array.from({ length: 18 + (index % 70) }, (_, line) => `${line + 1}\t${paragraph}`).join('\n');
      return {
        type: 'tool',
        id,
        runId,
        occurredAt,
        toolCallId: id,
        toolName: 'inspect',
        toolState: 'output-available',
        toolInput: { path: `part-${index}.ts` },
        toolOutput: output,
        toolDisplay: { form: 'text', title: `Inspect part ${index}`, text: output },
      };
    }
    if (index % 5 === 4)
      return { type: 'message', role: 'assistant', id, runId, occurredAt, text: `The result for part ${index} is ready.\n\n${paragraph}` };
    return {
      type: 'message',
      role: 'assistant',
      id,
      runId,
      occurredAt,
      text: markdown(index),
      attachments: index % 15 === 3 ? [{ mime: 'image/svg+xml', url: image, filename: `landscape-${index}.svg` }] : undefined,
    };
  });
}

export const streamChunk = (index: number): string => `\n\nStreaming paragraph ${index + 1}. ${paragraph}`;

export const observations = (count = ENTRY_COUNT): ObservedEntries => ({
  jump: 'jumpToLatest',
  message(key) {
    const entry = key.match(/entry-(\d+)/)?.[1];
    const run = key.match(/run-(\d+)/)?.[1];
    if (entry !== undefined) return userLabel(Math.floor(Number(entry) / 5) * 5);
    if (run !== undefined) return userLabel(Number(run) * 5);
    return key === STREAM_ID || key === 'live:status' ? userLabel(Math.floor((count - 1) / 5) * 5) : null;
  },
  kind(key) {
    const index = key.match(/entry-(\d+)/)?.[1];
    if (index === undefined) return key === 'live:status' ? 'status' : key === STREAM_ID ? 'assistant' : 'activity';
    return Number(index) % 5 === 0 ? 'user' : Number(index) % 5 === 2 ? 'tool' : 'assistant';
  },
  tail: (key) => key === 'live:status',
});
