import { describe, expect, test } from 'bun:test';
import { nearQuery, spellingsOf } from './fts.js';

describe('spellings', () => {
  test('a word answers its nearest spellings in the texts, and a word under four letters stays as typed', () => {
    const near = nearQuery('delegaton tst');
    expect(near === null ? null : spellingsOf(near, ['the delegation, a delegate'])?.terms).toEqual([['deleg'], ['tst']]);
    const swapped = nearQuery('tset');
    expect(swapped === null ? null : spellingsOf(swapped, ['set the settings, run the test'])?.terms).toEqual([['test']]);
    expect(nearQuery('tst')).toBeNull();
  });

  test('a word spelled as typed elsewhere keeps its near spelling beside it', () => {
    const near = nearQuery('grid featre');
    expect(near === null ? null : spellingsOf(near, ['grid feature', 'grip featre'])?.terms).toEqual([
      ['grid', 'grip'],
      ['featr', 'featur'],
    ]);
  });

  test('a word with no spelling near it in the texts answers none', () => {
    const near = nearQuery('kaleidoscope');
    expect(near === null ? undefined : spellingsOf(near, ['a telescope and a microscope'])).toBeNull();
  });
});
