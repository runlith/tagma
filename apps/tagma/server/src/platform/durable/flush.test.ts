import { describe, expect, test } from 'bun:test';
import { flushRoute, fullSyncOutcome } from './flush.js';

describe('durable flush dispatch', () => {
  test('sends only Darwin full-sync requests to the worker', () => {
    expect(flushRoute('darwin')).toBe('worker');
    expect(flushRoute('linux')).toBe('fsync');
    expect(flushRoute('win32')).toBe('fsync');
  });

  test('degrades only unsupported full-sync commands and fails on actual I/O errors', () => {
    expect(fullSyncOutcome({ id: 1, outcome: 'full' })).toBe('full');
    expect(fullSyncOutcome({ id: 2, outcome: 'errno', code: 45 })).toBe('degraded');
    expect(fullSyncOutcome({ id: 3, outcome: 'errno', code: 22 })).toBe('degraded');
    expect(() => fullSyncOutcome({ id: 4, outcome: 'errno', code: 5 })).toThrow('errno 5');
    expect(() => fullSyncOutcome({ id: 5, outcome: 'error', reason: 'worker failed' })).toThrow('worker failed');
  });
});
