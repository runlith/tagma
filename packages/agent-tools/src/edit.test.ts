import { describe, expect, test } from 'bun:test';
import { replace } from './edit';

describe('replace', () => {
  const text = ['{#if open}', '  <Chat />', '{:else}', '  <Empty />', '  <Footer />', '{/if}', ''].join('\n');

  test('an oldString whose first and last lines stand in the text but whose middle does not is refused', () => {
    const find = ['{#if open}', '  <Other />', '{/if}'].join('\n');
    expect(() => replace(text, find, '{#if open}\n  <Chat />\n{/if}')).toThrow(/Could not find oldString/);
    expect(text).toContain('<Empty />');
  });

  test('an oldString that differs only by indentation is applied to exactly its own lines', () => {
    const find = ['{:else}', '<Empty />', '<Footer />'].join('\n');
    const next = replace(text, find, '{:else}\n  <Nothing />');
    expect(next).toBe(['{#if open}', '  <Chat />', '{:else}', '  <Nothing />', '{/if}', ''].join('\n'));
  });

  test('a replacement carrying dollar patterns lands literally, on one match and on all', () => {
    const body = 'head\nXX\ntail\n';
    expect(replace(body, 'XX', "q$'e$&a$`b$$c$1d", true)).toBe("head\nq$'e$&a$`b$$c$1d\ntail\n");
    expect(replace(body, 'XX', "q$'z")).toBe("head\nq$'z\ntail\n");
  });
});
