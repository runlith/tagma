import type { ProjectedPart, Projection } from '@tagma/server/translations/contract/wire/projection';
import { expect, test } from 'vitest';
import { phaseOf, segmentsOf } from './Lens.svelte.js';

const part = (state: ProjectedPart['state'], source: string, text: string | null = null): ProjectedPart => ({
  kind: state === 'kept' ? 'kept' : 'text',
  source,
  state,
  text,
});

test('a projection reads translated and kept parts as written, pending ones as the original, changed ones apart', () => {
  const parts: readonly ProjectedPart[] = [
    { kind: 'title', source: 'Title', state: 'translated', text: 'Заголовок' },
    part('translated', 'One.', 'Один.'),
    part('kept', '```ts\nconst a = 1;\n```'),
    part('pending', 'Two.'),
    part('changed', 'Three, edited.'),
    part('changed', 'Four, added.'),
    part('translated', 'Five.', 'Пять.'),
  ];
  expect(segmentsOf(parts)).toEqual([
    { key: 1, kind: 'shown', text: 'Один.\n\n```ts\nconst a = 1;\n```' },
    { key: 3, kind: 'pending', text: 'Two.' },
    { key: 4, kind: 'changed', text: 'Three, edited.\n\nFour, added.' },
    { key: 6, kind: 'shown', text: 'Пять.' },
  ]);
});

test('untranslated parts read as outdated after a finished act and as stopped after a cut one', () => {
  const projection = (state: Projection['state'], changed: number): Projection => ({
    language: 'ru',
    state,
    model: 'anthropic:claude-haiku',
    rung: null,
    at: '2026-10-29T18:00:00.000Z',
    reason: null,
    failed: 0,
    translated: 4 - changed,
    changed,
    pending: 0,
    total: 4,
    parts: [],
    titles: [],
  });
  expect(phaseOf(projection('done', 0))).toBe('current');
  expect(phaseOf(projection('done', 2))).toBe('outdated');
  expect(phaseOf(projection('stopped', 2))).toBe('stopped');
  expect(phaseOf(projection('stopped', 0))).toBe('current');
  expect(phaseOf(projection('failed', 2))).toBe('failed');
});
