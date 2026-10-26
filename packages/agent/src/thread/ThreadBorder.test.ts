import { describe, expect, test } from 'bun:test';
import { ThreadCallBroke } from './ThreadBorder';
import { ThreadStorageFailed } from './persisted';

describe('ThreadBorder carriers', () => {
  test('a broken call says what broke it', () => {
    const broke = new ThreadCallBroke({ cause: new Error('graph-pool: the mirror refused the registry row') });
    expect(broke.message).toBe('graph-pool: the mirror refused the registry row');
  });

  test('a cause with no sentence still leaves one', () => {
    expect(new ThreadCallBroke({ cause: new Error('') }).message).toBe('Error carried no message');
    expect(new ThreadStorageFailed({ call: 'find', cause: new Error('') }).message).toBe(
      'Thread storage failed in find: Error carried no message',
    );
  });

  test('a wrapper that hides its driver failure still says it', () => {
    const query = new Error('Failed query: select 1', { cause: new Error('the driver refused the bound value') });
    expect(new ThreadStorageFailed({ call: 'threads.list', cause: query }).message).toBe(
      'Thread storage failed in threads.list: Failed query: select 1; caused by: the driver refused the bound value',
    );
  });
});
