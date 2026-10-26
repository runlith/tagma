import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import { THREAD_CHAT_COMMANDS, type ThreadSaidOnTheWire, threadSaidOnTheWire, threadSaidResultSchema, threadSendSchema } from './realtime';
import type { ThreadSaid } from '../thread/run/scheduler/inputs';

const decodeSend = Schema.decodeUnknownResult(threadSendSchema);
const encodeSaid = Schema.encodeUnknownResult(threadSaidResultSchema);
const decodeSaid = Schema.decodeUnknownResult(threadSaidResultSchema);

describe('thread send command boundary', () => {
  test('accepts uploaded attachment references instead of image bytes', () => {
    const byReference = decodeSend({ attachments: [{ id: '019f0000-0000-7000-8000-000000000001' }], key: 'input-1' });
    expect(byReference._tag).toBe('Success');

    const withBytes = decodeSend({
      attachments: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA', filename: 'screenshot.png' }],
      key: 'input-1',
    });
    expect(withBytes._tag).toBe('Failure');
  });
});

describe('what a thread answers on the wire', () => {
  test('every arm the thread can answer with encodes and decodes as itself', () => {
    const arms: readonly ThreadSaidOnTheWire[] = [
      { status: 'started', runId: 'run-1', acted: true, acceptance: { status: 'unconfirmed', reason: 'Host receipt was lost.' } },
      { status: 'steered', runId: 'run-1', itemId: 'input-1', acted: false },
      {
        status: 'queued',
        runId: 'run-1',
        acted: true,
        queued: { id: 'input-1', runId: 'run-1', text: 'and then this', occurredAt: '2026-06-26T10:00:00.000Z' },
      },
    ];
    for (const answered of arms) {
      const crossed = encodeSaid(answered);
      if (!Result.isSuccess(crossed)) throw new Error(`The wire refused an arm the thread answers: ${answered.status}`);
      const read = decodeSaid(JSON.parse(JSON.stringify(crossed.success)));
      if (!Result.isSuccess(read)) throw new Error(`An arm crossed and could not be read back: ${answered.status}`);
      expect(read.success).toEqual(answered);
    }
  });

  test('the projection drops the entry and keeps the arm the thread named', () => {
    const started: ThreadSaid = {
      status: 'started',
      runId: 'run-1',
      entry: { id: 'message:user:run-1', type: 'message' } as ThreadSaid extends { entry: infer E } ? E : never,
      acceptance: { status: 'unconfirmed', reason: 'Host receipt was lost.' },
    };
    expect(threadSaidOnTheWire(started)).toEqual({ status: 'started', runId: 'run-1', acted: true, acceptance: started.acceptance });
    expect(threadSaidOnTheWire({ status: 'steered', runId: 'run-2', itemId: 'input-2', replayed: true })).toEqual({
      status: 'steered',
      runId: 'run-2',
      itemId: 'input-2',
      acted: false,
    });
  });

  test('queue parses exactly what send parses', () => {
    expect(THREAD_CHAT_COMMANDS.queue).toBe(THREAD_CHAT_COMMANDS.send);
  });
});
