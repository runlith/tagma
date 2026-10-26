import type { Hand, Holding } from '@tagma/server/change-record/contract/wire/holdings';
import type { CheckoutEntry } from '@tagma/server/workspace/contract/wire/checkout';
import { expect, test } from 'vitest';
import type { CheckoutSection } from './Selection.svelte.js';
import { threadGroups } from './threadGroups.js';

const entry = (path: string, added = 1): CheckoutEntry => ({ path, status: 'modified', lines: { added, removed: 0 } });

const hand = (thread: string): Hand => ({ holder: { kind: 'thread', thread }, added: 1, removed: 0, writing: false, retired: false });

const yours: Hand = { holder: { kind: 'operator' }, added: 1, removed: 0, writing: false, retired: false };

const proven = (path: string, hands: readonly Hand[], nobody = false): Holding => ({
  path,
  from: null,
  git: 'modified',
  verdict: { verdict: 'proven', hands, nobody: nobody ? [{ added: 1, removed: 0, why: { kind: 'external' } }] : [] },
  lines: { added: 1, removed: 0 },
});

const of = (holdings: readonly Holding[]) => (path: string) => holdings.find((one) => one.path === path);

test('the operator’s paths list first under their own group, a path lists under every thread whose hands hold it, nobody’s lines list under other changes, and an unproven path under not verified', () => {
  const sections: CheckoutSection[] = [
    { name: 'staged', entries: [entry('src/shared.ts', 2)] },
    {
      name: 'changes',
      entries: [entry('src/shared.ts', 3), entry('src/loose.ts'), entry('src/mixed.ts'), entry('src/dark.ts'), entry('src/yours.ts')],
    },
    { name: 'graph', entries: [entry('.tagma/blocks/a.md')] },
  ];
  const holdings = [
    proven('src/shared.ts', [hand('t-1'), hand('t-2')]),
    proven('src/loose.ts', [], true),
    proven('src/yours.ts', [yours]),
    proven('src/mixed.ts', [hand('t-1')], true),
    {
      path: 'src/dark.ts',
      from: null,
      git: 'modified',
      verdict: { verdict: 'unknown', reason: { kind: 'budget' }, writers: [{ kind: 'thread', thread: 't-1' }] },
      lines: 'unweighed',
    } satisfies Holding,
  ];

  const groups = threadGroups(sections, of(holdings), (thread) => ({ 't-1': 'architect', 't-2': 'builder' })[thread] ?? null);

  expect(groups.map((group) => [group.name, group.entries.map((one) => one.path)])).toEqual([
    ['Your changes', ['src/yours.ts']],
    ['architect', ['src/shared.ts', 'src/mixed.ts']],
    ['builder', ['src/shared.ts']],
    ['Not verified', ['src/dark.ts']],
    ['Other changes', ['src/loose.ts', 'src/mixed.ts']],
  ]);
  const shared = groups[1]?.entries[0];
  expect([shared?.staged, shared?.unstaged, shared?.lines]).toEqual([true, true, { added: 5, removed: 0 }]);
});

test('a holder the thread list does not name is grouped under its id', () => {
  const sections: CheckoutSection[] = [{ name: 'changes', entries: [entry('a.md')] }];

  const groups = threadGroups(sections, of([proven('a.md', [hand('01a0d47d-unknown')])]));

  expect(groups.map((group) => group.name)).toEqual(['01a0d47d']);
});
