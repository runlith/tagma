import { describe, expect, test } from 'bun:test';
import { Data, Schema } from 'effect';
import { partialJsonReader, readConfirmedField, readPartialJson, readPartialJsonState, toJson } from './json.js';

describe('toJson', () => {
  test('native and tagged errors cross with their messages and tagged facts', () => {
    expect(toJson({ failure: new Error('the answer was not JSON') })).toEqual({ failure: { message: 'the answer was not JSON' } });
    class Refused extends Data.TaggedError('invalid-response')<{ readonly message: string }> {}
    expect(toJson({ failure: new Refused({ message: 'the answer was not JSON' }) })).toEqual({
      failure: { _tag: 'invalid-response', message: 'the answer was not JSON' },
    });
  });

  test('a date inside a class instance crosses as its ISO string', () => {
    class Observation {
      constructor(readonly observedAt: Date) {}
    }
    expect(toJson({ quota: new Observation(new Date('2026-09-29T05:42:33.005Z')) })).toEqual({
      quota: { observedAt: '2026-09-29T05:42:33.005Z' },
    });
  });

  test('a member holding undefined crosses as an absent key, and an array slot as null', () => {
    const crossed = toJson({ kept: 1, absent: undefined, list: [undefined, 2] });
    expect(crossed).toEqual({ kept: 1, list: [null, 2] });
    expect(Object.keys(crossed as object)).toEqual(['kept', 'list']);
  });

  test('an own __proto__ member crosses as data', () => {
    const crossed = toJson(JSON.parse('{"__proto__":{"inner":7},"kept":1}'));
    expect(JSON.stringify(crossed)).toBe('{"__proto__":{"inner":7},"kept":1}');
    expect(Object.getPrototypeOf(crossed)).toBe(Object.prototype);
  });

  test('whatever it is given, it answers a value the JSON codec accepts', () => {
    const looped: Record<string, unknown> = { name: 'loop' };
    looped['self'] = looped;
    const crossed = toJson({
      ratio: Number.NaN,
      limit: Number.POSITIVE_INFINITY,
      big: 12n,
      run: () => 1,
      mark: Symbol('mark'),
      looped,
      slots: [Number.NEGATIVE_INFINITY, () => 1],
      held: new Map([['a', 1]]),
    });
    expect(Schema.is(Schema.Json)(crossed)).toBe(true);
    expect(crossed).toEqual({ ratio: null, limit: null, big: '12', looped: { name: 'loop' }, slots: [null, null], held: {} });
    expect(toJson(undefined)).toBeNull();
  });

  test('a value that is already JSON crosses as itself, uncopied', () => {
    const clean = { rows: [{ path: 'a.ts', line: 1 }], total: 1 };
    expect(toJson(clean)).toBe(clean);
  });
});

const DOCUMENT = '{"path":"src/app.ts","lines":[1,23],"deep":{"ok":true},"n":-12.5e+3}';

describe('readPartialJson', () => {
  test('reads a whole document as the parser would', () => {
    expect(readPartialJson(DOCUMENT)).toEqual({
      path: 'src/app.ts',
      lines: [1, 23],
      deep: { ok: true },
      n: -12500,
    });
    expect(readPartialJson('  [1, "two", null, false]  ')).toEqual([1, 'two', null, false]);
    expect(readPartialJson('"just text"')).toBe('just text');
    expect(readPartialJson('null')).toBe(null);
  });

  test('distinguishes completed top-level fields from values closed only for reading', () => {
    expect(readPartialJsonState('{"name":"critic","task":"Half a li')).toEqual({
      value: { name: 'critic', task: 'Half a li' },
      complete: false,
      completedFields: ['name'],
    });
    expect(readPartialJsonState('{"name":"critic","task":"Half a line"}')).toEqual({
      value: { name: 'critic', task: 'Half a line' },
      complete: true,
      completedFields: ['name', 'task'],
    });
  });

  test('carries nothing while the text carries nothing', () => {
    expect(readPartialJson('')).toBeUndefined();
    expect(readPartialJson('   ')).toBeUndefined();
    expect(readPartialJson('-')).toBeUndefined();
  });

  test('closes an object at its last settled pair', () => {
    expect(readPartialJson('{')).toEqual({});
    expect(readPartialJson('{"pa')).toEqual({});
    expect(readPartialJson('{"path"')).toEqual({});
    expect(readPartialJson('{"path":')).toEqual({});
    expect(readPartialJson('{"path":"')).toEqual({ path: '' });
    expect(readPartialJson('{"path":"src/ap')).toEqual({ path: 'src/ap' });
    expect(readPartialJson('{"path":"src/app.ts",')).toEqual({ path: 'src/app.ts' });
    expect(readPartialJson('{"path":"a","lines":')).toEqual({ path: 'a' });
  });

  test('closes an array at its last settled element', () => {
    expect(readPartialJson('[')).toEqual([]);
    expect(readPartialJson('[1')).toEqual([1]);
    expect(readPartialJson('[1,')).toEqual([1]);
    expect(readPartialJson('[1,2')).toEqual([1, 2]);
    expect(readPartialJson('[[1,[2')).toEqual([[1, [2]]]);
    expect(readPartialJson('[{"a":[{"b":')).toEqual([{ a: [{}] }]);
  });

  test('drops a number that has not finished', () => {
    expect(readPartialJson('[-')).toEqual([]);
    expect(readPartialJson('[-12')).toEqual([-12]);
    expect(readPartialJson('[-12.')).toEqual([-12]);
    expect(readPartialJson('[-12.5')).toEqual([-12.5]);
    expect(readPartialJson('[-12.5e')).toEqual([-12.5]);
    expect(readPartialJson('[-12.5e+')).toEqual([-12.5]);
    expect(readPartialJson('[-12.5e+3')).toEqual([-12500]);
  });

  test('completes a literal from what it can only be', () => {
    expect(readPartialJson('[t')).toEqual([true]);
    expect(readPartialJson('[fal')).toEqual([false]);
    expect(readPartialJson('[nul')).toEqual([null]);
  });

  test('closes a string, and keeps a half-written escape out of it', () => {
    expect(readPartialJson('["ab')).toEqual(['ab']);
    expect(readPartialJson('["a\\')).toEqual(['a']);
    expect(readPartialJson('["a\\n')).toEqual(['a\n']);
    expect(readPartialJson('["a\\u00')).toEqual(['a']);
    expect(readPartialJson('["a\\u0041')).toEqual(['aA']);
    expect(readPartialJson('["a\\"b')).toEqual(['a"b']);
  });

  test('a confirmed field carries the characters that arrived, and says whether it finished', () => {
    const arriving = '{"filePath":"/tmp/a.html","content":"<p>caf\\u00e9</p>';
    expect(readConfirmedField(arriving, 'content')).toEqual({ text: '<p>café</p>', closed: false });
    expect(readConfirmedField(`${arriving}"}`, 'content')).toEqual({ text: '<p>café</p>', closed: true });
    expect(readConfirmedField(arriving, 'filePath')).toEqual({ text: '/tmp/a.html', closed: true });
  });

  test('a confirmed field stops before an escape the stream has not finished', () => {
    expect(readConfirmedField('{"content":"a\\', 'content')).toEqual({ text: 'a', closed: false });
    expect(readConfirmedField('{"content":"a\\u00', 'content')).toEqual({ text: 'a', closed: false });
    expect(readConfirmedField('{"content":"a\\u00e9', 'content')).toEqual({ text: 'aé', closed: false });
    expect(readConfirmedField('{"content":"a\\"b', 'content')).toEqual({ text: 'a"b', closed: false });
  });

  test('a confirmed field never ends on half a character', () => {
    const half = readConfirmedField('{"content":"ok\\uD83D', 'content');
    expect(half).toEqual({ text: 'ok', closed: false });
    expect(Buffer.from(half?.text ?? '', 'utf8').toString('hex')).toBe('6f6b');
    expect(readConfirmedField('{"content":"ok\\uD83D\\uDE00', 'content')).toEqual({ text: 'ok😀', closed: false });
  });

  test('a confirmed field refuses what no reading of it can decide', () => {
    expect(readPartialJson('{"content":"first","content":"seco')).toEqual({ content: 'seco' });
    expect(readConfirmedField('{"content":"first","content":"seco', 'content')).toBeUndefined();
    expect(readConfirmedField('{"content":12', 'content')).toBeUndefined();
    expect(readConfirmedField('{"content":{"a":"b"', 'content')).toBeUndefined();
    expect(readConfirmedField('{"other":"x"', 'content')).toBeUndefined();
    expect(readConfirmedField('{"outer":{"content":"nested"', 'content')).toBeUndefined();
    expect(readConfirmedField('{"content":"ok",!', 'content')).toBeUndefined();
  });

  test('drops a key that is still being written, escaped quotes and all', () => {
    expect(readPartialJson('{"a":1,"b')).toEqual({ a: 1 });
    expect(readPartialJson('{"a":1,"b\\"c')).toEqual({ a: 1 });
    expect(readPartialJson('{"a\\"b":2}')).toEqual({ 'a"b': 2 });
  });

  test('reads nothing from text that is no JSON prefix', () => {
    expect(readPartialJson('abc')).toBeUndefined();
    expect(readPartialJson('{"a" 1}')).toBeUndefined();
    expect(readPartialJson('{,}')).toBeUndefined();
    expect(readPartialJson('[1,]')).toBeUndefined();
    expect(readPartialJson('[01]')).toBeUndefined();
    expect(readPartialJson('[tru,1]')).toBeUndefined();
    expect(readPartialJson('[1] 2')).toBeUndefined();
    expect(readPartialJson(']')).toBeUndefined();
  });

  test('never falls back to nothing once a document says something', () => {
    for (const document of [DOCUMENT, '[[],{"a":[1,2]},"x\\u0041y",true]', '{"a":{"b":{"c":[-1.5e-3]}}}']) {
      let said = false;
      for (let length = 1; length <= document.length; length += 1) {
        const value = readPartialJson(document.slice(0, length));
        if (value !== undefined) said = true;
        else expect(said).toBe(false);
      }
      expect(readPartialJson(document)).toEqual(JSON.parse(document));
    }
  });

  test('a resumable read matches every whole prefix and examines each character once', () => {
    const cases = [
      DOCUMENT,
      '[[],{"a":[1,2]},"x\\u0041y",true]',
      '{"a":{"b":{"c":[-1.5e-3]}}}',
      '{"a\\"b":2,"\\u0063":true,"a\\"b":3}',
      '  [1, "two", null, false]  ',
      '"just text"',
      '-12.5e+3 ',
    ];
    for (const document of cases) expectIncremental(document, 1);

    const bytes = 16 * 1024;
    const head = '{"name":"critic","task":"';
    const tail = '"}';
    expectIncremental(head + 'x'.repeat(bytes - head.length - tail.length) + tail, 2 * 1024);
  });

  test('a state remains the snapshot returned before later pieces arrive', () => {
    const reader = partialJsonReader();
    const open = reader.push('{"a":"x');
    const firstField = reader.push('y","b":');
    expect(reader.push('"z"}')).toEqual({ value: { a: 'xy', b: 'z' }, complete: true, completedFields: ['a', 'b'] });
    expect(open).toEqual({ value: { a: 'x' }, complete: false, completedFields: [] });
    expect(firstField).toEqual({ value: { a: 'xy' }, complete: false, completedFields: ['a'] });
  });

  test('a pending token resumes, while an invalid prefix poisons only its own reader', () => {
    const pending = partialJsonReader();
    expect(pending.push('-')).toBeUndefined();
    expect(pending.push('12 ')).toEqual({ value: -12, complete: true, completedFields: [] });
    expect(pending.examined).toBe(4);

    const invalid = partialJsonReader();
    expect(invalid.push('[0')).toEqual({ value: [0], complete: false, completedFields: [] });
    expect(invalid.push('1]')).toBeUndefined();
    const stoppedAt = invalid.examined;
    expect(invalid.push(' trailing bytes')).toBeUndefined();
    expect(invalid.examined).toBe(stoppedAt);

    const invalidKey = partialJsonReader();
    expect(invalidKey.push('{"a\n"')).toBeUndefined();
  });

  test('a reading keeps its value while a piece adds nothing readable, and shares what has settled', () => {
    const reader = partialJsonReader();
    const first = reader.push('{"a":{"b":[1]},"c":"x');
    const pending = reader.push('\\');
    expect(pending?.value).toBe(first?.value);
    const grown = reader.push('ny');
    expect(grown?.value).toEqual({ a: { b: [1] }, c: 'x\ny' });
    expect(grown?.value).not.toBe(first?.value);
    expect((grown?.value as { a: unknown }).a).toBe((first?.value as { a: unknown }).a);
    expect(first?.value).toEqual({ a: { b: [1] }, c: 'x' });
  });

  test('a __proto__ key is read as an own field, as the parser reads it', () => {
    const read = readPartialJson('{"__proto__":{"polluted":true},"x":1}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(Object.keys(read)).toEqual(['__proto__', 'x']);
    expect(Object.getPrototypeOf(readPartialJson('{"__proto__":{"a":"b'))).toBe(Object.prototype);
  });

  test('root numbers and literals settle only when a following byte closes the token', () => {
    for (const [token, value] of [
      ['1', 1],
      ['true', true],
      ['null', null],
    ] as const) {
      const reader = partialJsonReader();
      expect(reader.push(token)).toEqual({ value, complete: false, completedFields: [] });
      expect(reader.push(' ')).toEqual({ value, complete: true, completedFields: [] });
    }
  });
});

function expectIncremental(document: string, chunkSize: number): void {
  const reader = partialJsonReader();
  for (let start = 0; start < document.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, document.length);
    const incremental = reader.push(document.slice(start, end));
    expect(incremental).toEqual(readPartialJsonState(document.slice(0, end)));
    expect(reader.examined).toBe(end);
  }
}
