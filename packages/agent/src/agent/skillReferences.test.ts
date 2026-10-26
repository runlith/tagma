import { describe, expect, test } from 'bun:test';
import { skillInsertion, skillQuery, skillReference, skillReferences } from './skillReferences';

describe('skill references', () => {
  test('returns exact editable ranges without changing surrounding Unicode text', () => {
    const text = 'Name 𝄞 with $ag-term, then use $artifacts. Again $ag-term!';
    const references = skillReferences(text);
    expect(references.map((reference) => reference.id)).toEqual(['ag-term', 'artifacts', 'ag-term']);
    expect(references.map((reference) => text.slice(reference.from, reference.to))).toEqual(['$ag-term', '$artifacts', '$ag-term']);
    const caret = text.indexOf('$artifacts') + '$art'.length;
    const query = skillQuery(text, caret, caret);
    expect(query).toEqual({ query: 'art', from: text.indexOf('$artifacts'), to: text.indexOf('$artifacts') + '$artifacts'.length });
    expect(text.slice(0, query!.from) + '$svelte5' + text.slice(query!.to)).toBe(
      'Name 𝄞 with $ag-term, then use $svelte5. Again $ag-term!',
    );
  });

  test('keeps dollars, code and non-token substrings literal', () => {
    const text = [
      '$100 $HOME $$writer \\$writer embedded$writer $writer/path $writer_name $writerSuffix',
      '`$writer` ``a `$writer` example``',
      '```ts',
      '$writer',
      '```',
      '~~~',
      '$writer',
      '~~~',
      '$reader',
    ].join('\n');
    expect(skillReferences(text).map((reference) => reference.id)).toEqual(['reader']);
    const caret = text.indexOf('$writer`') + '$writer'.length;
    expect(skillQuery(text, caret, caret)).toBeNull();
  });

  test('does not turn an unfinished code region into an invocation while typing', () => {
    expect(skillReferences('Before ` $writer')).toEqual([]);
    expect(skillReferences('Before\n```\n$writer')).toEqual([]);
    expect(skillReferences('Before\n~~~\n$writer')).toEqual([]);
    expect(skillReferences('``literal ` $writer `` then $reader').map((reference) => reference.id)).toEqual(['reader']);
  });

  test('a bare dollar is a caret query, not a request', () => {
    expect(skillReferences('$')).toEqual([]);
    expect(skillQuery('$', 1, 1)).toEqual({ query: '', from: 0, to: 1 });
    expect(skillQuery('Before $ after', 8, 8)).toEqual({ query: '', from: 7, to: 8 });
    expect(skillQuery('Before $writer after', 8, 8)).toEqual({ query: '', from: 7, to: 14 });
    expect(skillQuery('Before $writer after', 7, 14)).toBeNull();
    expect(skillQuery('$writer after', 0, 0)).toBeNull();
    expect(skillQuery('$writer after', 9, 9)).toBeNull();
  });

  test('quoted references round-trip every loadable name without claiming shell variables', () => {
    for (const id of ['writer', 'Review Notes', '日本語', 'with"quote', 'with\\slash', 'with\nline']) {
      const token = skillReference(id);
      expect(skillReferences(`Before ${token} after`)).toEqual([{ id, from: 7, to: 7 + token.length }]);
    }
    expect(skillReferences('$HOME')).toEqual([]);
    expect(skillReferences('$"Review Notes')).toEqual([]);
    expect(skillQuery('$"Review Notes" after', 5, 5)).toEqual({ query: 'Rev', from: 0, to: 15 });
    expect(skillQuery('$"Review', 8, 8)).toEqual({ query: 'Review', from: 0, to: 8 });
  });

  test('a reference label cannot request a skill of its own', () => {
    const text = 'Read [[deadbeef|Title $writer]] with $reader';
    expect(skillReferences(text).map((reference) => reference.id)).toEqual(['reader']);
    const caret = text.indexOf('$writer') + 4;
    expect(skillQuery(text, caret, caret)).toBeNull();
    expect(skillReferences('Read [[unfinished $writer')).toEqual([]);
  });

  test('a fence closes only with its own marker and sufficient length', () => {
    const text = ['````', '```', '$hidden', '~~~~', '$hidden', '````', '$shown'].join('\n');
    expect(skillReferences(text).map((reference) => reference.id)).toEqual(['shown']);
  });

  test('an inserted reference is followed by one separator unless text already separates it, so a word typed next never fuses with it; punctuation after it stays attached', () => {
    const typed = (before: string, id: string, suffix: string, word: string) => {
      const insertion = skillInsertion(id, suffix);
      const caret = before.length + insertion.text.length + insertion.skip;
      const text = `${before}${insertion.text}${suffix}`;
      return `${text.slice(0, caret)}${word}${text.slice(caret)}`;
    };

    expect(typed('', 'artifacts', '', 'say')).toBe('$artifacts say');
    expect(typed('', 'artifacts', ' later', 'say')).toBe('$artifacts saylater');
    expect(typed('', 'artifacts', ', later', 'say')).toBe('$artifactssay, later');
    expect(typed('', 'Review Notes', '', 'say')).toBe('$"Review Notes" say');
  });
});
