import { describe, expect, test } from 'bun:test';
import { redactSecrets, secretsOf } from './redact';

describe('redactSecrets', () => {
  test('a JSON string value holding an escaped quote redacts whole, with no tail standing', () => {
    expect(redactSecrets(JSON.stringify({ token: 'a"b' }))).toBe('{"token":"<redacted>"}');
  });

  test('an unquoted JSON key redacts like a quoted one', () => {
    expect(redactSecrets('{token:"x"}')).toBe('{token:"<redacted>"}');
  });

  test('a plain quoted pair redacts the value and leaves other keys standing', () => {
    expect(redactSecrets('{"token":"abc","a":"b"}')).toBe('{"token":"<redacted>","a":"b"}');
  });

  test('a query string pair redacts the value', () => {
    expect(redactSecrets('?token=x')).toBe('?token=<redacted>');
  });

  test('a value sent through a recognized name redacts wherever it stands', () => {
    const secrets = secretsOf([['authorization', 'sekret-value']]);
    expect(redactSecrets('failed with sekret-value', secrets)).toBe('failed with <redacted>');
  });

  test('a value with no closing quote redacts the value and its escaped tail', () => {
    const result = redactSecrets('{"token":"sekret\\"}');
    expect(result).toContain('<redacted>');
    expect(result).not.toContain('sekret');
    expect(result).not.toContain('\\');
  });

  test('a value truncated right after its backslash redacts instead of leaving the secret standing', () => {
    const result = redactSecrets('{"token":"abc\\');
    expect(result).toContain('<redacted>');
    expect(result).not.toContain('abc');
    expect(result).not.toContain('\\');
  });

  test('a backslash before a real newline inside the value still redacts whole', () => {
    expect(redactSecrets('{"token":"ab\\\ncd"}')).toBe('{"token":"<redacted>"}');
  });

  test('a value truncated at end of line does not swallow the next key on the next line', () => {
    const result = redactSecrets('{"token":"abc\\\n,"apikey":"sk-live-1"}');
    expect(result).toContain('"apikey":"<redacted>"');
    expect(result).not.toContain('sk-live-1');
    expect(result).not.toContain('abc');
  });

  test('a quoted key holding a sensitive stem stays untouched while the stem alone redacts', () => {
    expect(redactSecrets('{"sometoken":"x"}')).toBe('{"sometoken":"x"}');
    expect(redactSecrets('{"token":"x"}')).toBe('{"token":"<redacted>"}');
  });

  test('a bare key holding a sensitive stem stays untouched while a stem at a word boundary redacts', () => {
    expect(redactSecrets('xtoken:"x"}')).toBe('xtoken:"x"}');
    expect(redactSecrets('my-token:"x"')).toBe('my-token:"<redacted>"');
  });
});
