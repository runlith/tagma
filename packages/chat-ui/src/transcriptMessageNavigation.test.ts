import { describe, expect, test } from 'vitest';
import { messageOffsetTarget } from './transcriptMessageNavigation';

describe('assistant transcript message navigation', () => {
  test('moves through transcript messages and resumes latest past the end', () => {
    expect(messageOffsetTarget({ currentId: 'msg-2', ids: ['msg-1', 'msg-2', 'msg-3'], offset: -1 })).toEqual({
      id: 'msg-1',
      kind: 'message',
    });
    expect(messageOffsetTarget({ currentId: 'msg-3', ids: ['msg-1', 'msg-2', 'msg-3'], offset: 1 })).toEqual({
      kind: 'latest',
    });
    expect(messageOffsetTarget({ currentId: undefined, ids: ['msg-1', 'msg-2'], offset: -1 })).toEqual({
      id: 'msg-2',
      kind: 'message',
    });
    expect(messageOffsetTarget({ currentId: 'missing', ids: ['msg-1', 'msg-2'], offset: -3 })).toEqual({
      kind: 'none',
    });
  });
});
