import { describe, expect, test } from 'vitest';
import { TranscriptProjection } from './entryProjection';
import { USER_QUESTION_TOOL_NAME } from '@runlith/agent/transcript/parts';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ChatEntryHandlers } from './entries';
const entriesFromTranscript = (transcript: readonly ThreadTranscriptEntry[], handlers?: ChatEntryHandlers) =>
  new TranscriptProjection(handlers).entries(transcript);
const txEntries = <T extends readonly { readonly type: string; readonly id: string }[]>(entries: T): readonly ThreadTranscriptEntry[] =>
  entries;

const widgetPrompt = 'widget question prompt';
const genderPrompt = 'gender question prompt';

describe('assistant transcript entries', () => {
  test('restores persisted reasoning entries from the server transcript', () => {
    expect(
      entriesFromTranscript(
        txEntries([
          {
            type: 'reasoning',
            id: 'message-1:reasoning',
            text: 'Use a beginner-friendly next step.',
            state: 'done',
            occurredAt: '2026-05-30T04:34:00.000Z',
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'message-1:reasoning',
        kind: 'reasoning',
        occurredAt: '2026-05-30T04:34:00.000Z',
        text: 'Use a beginner-friendly next step.',
        reasoningState: 'done',
      },
    ]);
  });

  test('a stored compaction carries who summarized it, or the members a refused one passed over', () => {
    const summarizer = {
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      reasoning: null,
      account: 'key-1',
      own: false,
      reason: 'cold' as const,
      skipped: [{ provider: 'muse', model: 'muse-spark-1.3', reason: 'quota' as const, until: '2026-09-25T18:40:00.000Z' }],
      passes: 2,
    };
    const refused = { skipped: [{ provider: 'muse', model: 'muse-spark-1.3', reason: 'not-connected' as const }] };
    const [done, failed] = entriesFromTranscript(
      txEntries([
        { type: 'compaction', id: 'compaction-1', mode: 'manual', status: 'completed', summarizer },
        { type: 'compaction', id: 'compaction-2', mode: 'manual', status: 'failed', noSummarizer: refused },
      ]),
    );
    expect(done).toMatchObject({ kind: 'compaction', compactionSummarizer: summarizer });
    expect(failed).toMatchObject({ kind: 'compaction', compactionUnsummarized: refused });
  });

  test('restores persisted tool entries from the server transcript', () => {
    expect(
      entriesFromTranscript(
        txEntries([
          {
            type: 'tool',
            id: 'tool:tool-1',
            toolName: 'record_learning_result',
            toolCallId: 'tool-1',
            toolState: 'output-available',
            toolInput: { kind: 'lexeme', key: 'hello', activity: 'production', outcome: 'success' },
            toolOutput: { evidenceId: 'evidence-1' },
            occurredAt: '2026-05-30T04:34:00.000Z',
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'tool:tool-1',
        kind: 'tool',
        occurredAt: '2026-05-30T04:34:00.000Z',
        toolName: 'record_learning_result',
        toolCallId: 'tool-1',
        toolState: 'output-available',
        toolInput: { kind: 'lexeme', key: 'hello', activity: 'production', outcome: 'success' },
        toolOutput: { evidenceId: 'evidence-1' },
      },
    ]);
  });

  test('restores persisted provider failures as error entries', () => {
    expect(
      entriesFromTranscript(
        txEntries([
          {
            type: 'failure',
            id: 'transcript:error:run-1',
            runId: 'run-1',
            message: 'model endpoint returned 404',
            diagnostics: {
              provider: 'openai-oauth',
              stage: 'RequestExecutor.execute',
              type: 'InvalidRequest',
              httpStatus: 404,
              retryable: false,
              modelStarted: false,
              record: { threadId: 'thread-1', runId: 'run-1', entryId: 'transcript:error:run-1' },
            },
            occurredAt: '2026-05-30T04:34:00.000Z',
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'transcript:error:run-1',
        kind: 'error',
        runId: 'run-1',
        occurredAt: '2026-05-30T04:34:00.000Z',
        text: 'model endpoint returned 404',
        diagnostics: {
          provider: 'openai-oauth',
          stage: 'RequestExecutor.execute',
          type: 'InvalidRequest',
          httpStatus: 404,
          retryable: false,
          modelStarted: false,
          record: { threadId: 'thread-1', runId: 'run-1', entryId: 'transcript:error:run-1' },
        },
      },
    ]);
  });

  test('restores persisted user interruptions as timeline dividers', () => {
    expect(
      entriesFromTranscript(
        txEntries([
          {
            type: 'interruption',
            id: 'interruption:run-1',
            runId: 'run-1',
            text: 'Interrupted by user',
            occurredAt: '2026-06-20T08:00:00.000Z',
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'interruption:run-1',
        kind: 'interruption',
        runId: 'run-1',
        text: 'Interrupted by user',
        occurredAt: '2026-06-20T08:00:00.000Z',
      },
    ]);
  });

  test('restores a persisted retry as its own entry, with the wait it began', () => {
    expect(
      entriesFromTranscript(
        txEntries([
          {
            type: 'retry',
            id: 'retry:run-1:0:1',
            runId: 'run-1',
            stepNumber: 0,
            attempt: 1,
            of: 5,
            family: 'torn-stream',
            delayMs: 200,
            message: 'Failed to read the stream',
            occurredAt: '2026-09-05T14:31:29.000Z',
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'retry:run-1:0:1',
        kind: 'retry',
        runId: 'run-1',
        occurredAt: '2026-09-05T14:31:29.000Z',
        attempt: 1,
        of: 5,
        family: 'torn-stream',
        delayMs: 200,
        message: 'Failed to read the stream',
      },
    ]);
  });

  test('an attachment is projected at the address the reader resolves', () => {
    const recorded = txEntries([
      {
        type: 'message',
        id: 'message-1',
        role: 'user',
        text: 'look at this',
        attachments: [{ mime: 'image/png', url: '/api/threads/thread-1/attachments/image-1.png', filename: 'shot.png' }],
        occurredAt: '2026-09-01T21:00:00.000Z',
      },
    ]);

    expect(entriesFromTranscript(recorded, { attachmentUrl: (url) => `${url}?project=7` })).toEqual([
      {
        id: 'message-1',
        kind: 'user',
        text: 'look at this',
        occurredAt: '2026-09-01T21:00:00.000Z',
        attachments: [
          {
            mime: 'image/png',
            url: '/api/threads/thread-1/attachments/image-1.png?project=7',
            filename: 'shot.png',
          },
        ],
      },
    ]);
  });

  test("a tool row's picture is projected at the address the reader resolves", () => {
    const picture = { url: '/api/threads/thread-1/attachments/shot.png', mediaType: 'image/png', width: 10, height: 10 };
    const recorded = txEntries([
      {
        type: 'tool',
        id: 'tool-1',
        toolName: 'webfetch',
        toolCallId: 'call-1',
        toolState: 'output-available',
        toolDisplay: { form: 'none', images: [picture] },
      },
    ]);

    const [entry] = entriesFromTranscript(recorded, { attachmentUrl: (url) => `${url}?project=7` });
    expect(entry?.kind === 'tool' ? entry.display?.images : undefined).toEqual([
      { ...picture, url: '/api/threads/thread-1/attachments/shot.png?project=7' },
    ]);
  });

  test('the question tool has no row of its own beside the question entry it asked', () => {
    const shown = entriesFromTranscript(
      txEntries([
        {
          type: 'tool',
          id: 'tool:q-1',
          runId: 'run-1',
          toolName: USER_QUESTION_TOOL_NAME,
          toolCallId: 'q-1',
          toolState: 'output-available',
        },
        {
          type: 'question',
          id: 'question-1',
          runId: 'run-1',
          questionId: 'q-1',
          status: 'open',
          toolCalls: [{ toolCallId: 'q-1', toolName: USER_QUESTION_TOOL_NAME }],
          questions: [{ id: 'p-1', toolCallId: 'q-1', kind: 'choice', prompt: 'which?' }],
        },
      ]),
    );

    expect(shown.map((entry) => entry.kind)).toEqual(['question']);
  });

  test('a refused call keeps the code and reason the producer settled it with', () => {
    const [entry] = entriesFromTranscript(
      txEntries([
        {
          type: 'tool',
          id: 'tool:r',
          runId: 'run-1',
          toolName: 'start_turn',
          toolCallId: 'r',
          toolState: 'output-refused',
          toolRefusal: { code: 'busy', reason: 'Another run holds the thread.' },
        },
      ]),
    );

    expect(entry).toMatchObject({ kind: 'tool', toolState: 'output-refused', toolRefusal: { code: 'busy' } });
  });
});
