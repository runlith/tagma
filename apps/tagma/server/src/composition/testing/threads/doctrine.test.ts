import { expect, test } from 'bun:test';
import type { DoctrineSection } from '../../../platform/contract/wire/section.js';
import {
  contributions,
  failsWith,
  isContributionInvalid,
  isSectionOrderConflict,
  isSectionValueMissing,
  renderSection,
  renderSections,
} from '../../../threads/testing/doubles.js';

const section = (id: string, rank: number): DoctrineSection => ({
  id,
  owner: 'module',
  render: () => id,
  path: `src/module/${id}.ts`,
  place: { prompt: rank },
});

test('a contribution takes its declared position regardless of module registration order', () => {
  const first = section('first', 10);
  const added = section('added', 20);
  const last = section('last', 30);
  const contributed = contributions([last, added, first]);
  expect(contributed.assemblies.prompt).toEqual(['first', 'added', 'last']);
  expect(renderSections(contributed.assemblies.prompt!, { contributed })).toEqual(['first', 'added', 'last']);
});

test('two sections at one rank refuse the assembly and identify both sections', () => {
  try {
    contributions([section('first', 10), section('second', 10)]);
    throw new Error('The rank collision was accepted.');
  } catch (error) {
    if (!isSectionOrderConflict(error)) throw error;
    expect(error.assembly).toBe('prompt');
    expect(error.rank).toBe(10);
    expect(error.sections).toEqual(['first', 'second']);
  }
});

test('a duplicate section identity is refused even when its placements differ', () => {
  expect(failsWith(() => contributions([section('repeated', 10), section('repeated', 20)]), isContributionInvalid)).toBe(true);
});

test('a section needing an identity refuses an incomplete render and receives the supplied identity', () => {
  const contributed = contributions([{ ...section('identity', 10), render: (context) => context.identity }]);
  expect(failsWith(() => renderSection('identity', { contributed }), isSectionValueMissing)).toBe(true);
  expect(renderSection('identity', { contributed, identity: 'reader' })).toBe('reader');
});

test('conditional contributions follow checkout, graph and declared fact context', () => {
  const contributed = contributions([
    section('always', 10),
    { ...section('checkout', 20), when: 'checkout' },
    { ...section('graph', 30), when: 'code' },
    { ...section('declared', 40), fact: 'fixture' },
  ]);
  const ids = contributed.assemblies.prompt!;
  expect(renderSections(ids, { contributed })).toEqual(['always', 'checkout', 'graph']);
  expect(renderSections(ids, { contributed, checkout: 'single', graphOverCode: false, facts: { fixture: true } })).toEqual([
    'always',
    'declared',
  ]);
});
