import { describe, expect, test } from 'bun:test';
import { Data } from 'effect';
import { describeError, describeErrors, errorChain } from './error.js';

describe('describeError', () => {
  test('renders an Error with its name and cause chain', () => {
    const error = new Error('retry failed', { cause: new TypeError('socket closed') });
    error.name = 'AI_RetryError';
    expect(describeError(error)).toBe('AI_RetryError: retry failed; cause: TypeError: socket closed');
  });

  test('renders a plain Error by message alone', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  test('renders non-errors as JSON, never "[object Object]"', () => {
    expect(describeError({ type: 'overloaded_error' })).toBe('{"type":"overloaded_error"}');
    expect(describeError('plain text')).toBe('"plain text"');
    expect(describeError(undefined)).toBe('undefined');
  });

  test('falls back to String for unserializable values', () => {
    expect(describeError(10n)).toBe('10');
  });

  test('keeps the head of an oversized message, says what it dropped, and still delivers the cause under it', () => {
    const statement = `Failed query: select "key" from "performance_group" where "key" not in (${'?, '.repeat(88_765)})`;
    const error = new Error(statement, { cause: new Error('SQLite query expected 23230 values, received 88766') });
    error.name = 'EffectDrizzleQueryError';

    const rendered = describeError(error);
    expect(rendered.startsWith('EffectDrizzleQueryError: Failed query: select "key" from "performance_group"')).toBe(true);
    expect(rendered).toContain(`(cut, ${statement.length} characters)`);
    expect(rendered).toContain('SQLite query expected 23230 values, received 88766');
    expect(rendered.length).toBeLessThan(11_000);
  });
});

describe('errorChain', () => {
  test('answers one link per failure, our side first and the side that broke it last', () => {
    const error = new Error('the read failed', { cause: new TypeError('owners is not a function') });
    expect(errorChain(error)).toEqual([
      { tag: 'Error', message: 'the read failed' },
      { tag: 'TypeError', message: 'owners is not a function' },
    ]);
  });

  test('names a value by its own tag where it carries one', () => {
    class Refused extends Data.TaggedError('Refused')<{ readonly message: string }> {}
    expect(errorChain(new Refused({ message: 'the gate said no' }))).toEqual([{ tag: 'Refused', message: 'the gate said no' }]);
  });

  test('ends the chain at a value that is not an Error, kept as what it is', () => {
    expect(errorChain({ read: 'settings' })).toEqual([{ tag: 'Object', message: '{"read":"settings"}' }]);
    expect(errorChain(undefined)).toEqual([]);
  });

  test('bounds a link message and never the tag that classifies it', () => {
    const [link] = errorChain(new Error('x'.repeat(3_000)));
    expect(link?.tag).toBe('Error');
    expect(link?.message).toContain('(cut, 3000 characters)');
    expect(link?.message.length).toBeLessThan(2_100);
  });

  test('stops at five links, however deep the wrapping goes', () => {
    let error = new Error('deepest');
    for (let depth = 0; depth < 9; depth += 1) error = new Error(`layer ${depth}`, { cause: error });
    expect(errorChain(error)).toHaveLength(5);
  });
});

describe('describeErrors', () => {
  test('renders every failure it was given, each with its own chain', () => {
    expect(describeErrors([new Error('first', { cause: new Error('under it') }), { code: 17 }])).toBe(
      'first; cause: under it · {"code":17}',
    );
  });
});
