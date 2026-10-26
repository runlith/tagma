import { describe, expect, test } from 'vitest';
import { messageOffsetTarget, resolveCurrentMessageId, resolvePinnedMessageId } from './transcriptMessageNavigation';

describe('assistant transcript message navigation', () => {
  test('keeps pinned message only until the user scroll mark changes', () => {
    expect(resolvePinnedMessageId({ pinnedId: 'msg-2', pinnedMark: 4, scrollMark: 4 })).toBe('msg-2');
    expect(resolvePinnedMessageId({ pinnedId: 'msg-2', pinnedMark: 4, scrollMark: 5 })).toBeUndefined();
    expect(resolvePinnedMessageId({ pinnedId: undefined, pinnedMark: 4, scrollMark: 4 })).toBeUndefined();
  });

  test('prefers viewport cursor while following, then pinned, then active turn', () => {
    expect(
      resolveCurrentMessageId({
        activeId: 'msg-active',
        cursorId: 'msg-cursor',
        following: true,
        pinnedId: 'msg-pinned',
      }),
    ).toBe('msg-cursor');
    expect(
      resolveCurrentMessageId({
        activeId: 'msg-active',
        cursorId: undefined,
        following: true,
        pinnedId: 'msg-pinned',
      }),
    ).toBe('msg-active');
    expect(
      resolveCurrentMessageId({
        activeId: 'msg-active',
        cursorId: 'msg-cursor',
        following: false,
        pinnedId: 'msg-pinned',
      }),
    ).toBe('msg-pinned');
    expect(
      resolveCurrentMessageId({
        activeId: 'msg-active',
        cursorId: 'msg-cursor',
        following: false,
        pinnedId: undefined,
      }),
    ).toBe('msg-cursor');
  });

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
