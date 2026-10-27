import { expect, test } from 'bun:test';
import { releaseAfter, type StoreMarks } from '../contract/wire/feed.js';
import { irreversibleOf, unfoldedOf } from './pipeline.js';
import { feedEntry, type ReleaseRecord } from './stage.js';

const STORES: StoreMarks = {
  'machine-store': ['20261010115509_baseline'],
  'host-store': ['20260908052548_shocking_gateway'],
  graph: ['decision-becomes-spec'],
  journal: ['20261010205500_place_guidance'],
};

const record = (release: string, irreversible: ReleaseRecord['irreversible']): ReleaseRecord => ({
  release,
  commit: 'abc1234',
  platforms: { 'darwin-arm64': { archive: `tagma-${release}-darwin-arm64.tar.gz`, sha256: '0'.repeat(64), size: 100 } },
  images: { 'darwin-arm64': `Tagma-${release}-arm64.dmg` },
  stores: STORES,
  irreversible,
  notarized: false,
});

test('a release declares irreversible each store it changed past the published release before it, and carries every change declared before it', () => {
  const published = {
    stores: { ...STORES, graph: [...STORES.graph, 'claims-leave'] },
    changes: [{ store: 'graph' as const, release: '0.1.1' }],
  };

  expect(irreversibleOf('0.1.0', STORES, null)).toEqual([]);
  expect(irreversibleOf('0.1.2', published.stores, published)).toEqual([{ store: 'graph', release: '0.1.1' }]);
  expect(
    irreversibleOf('0.1.2', { ...published.stores, 'machine-store': [...STORES['machine-store'], '20261011000000_more'] }, published),
  ).toEqual([
    { store: 'graph', release: '0.1.1' },
    { store: 'machine-store', release: '0.1.2' },
  ]);
});

test('a feed entry flags the release irreversible only when it made a change itself, and carries every change for the release after it', () => {
  const carried = feedEntry(record('0.1.2', [{ store: 'graph', release: '0.1.1' }]), () => 'https://example/a.tar.gz');
  const own = feedEntry(record('0.1.2', [{ store: 'graph', release: '0.1.2' }]), () => 'https://example/a.tar.gz');

  expect([carried.irreversible, own.irreversible]).toEqual([false, true]);
  expect(carried.changes).toEqual([{ store: 'graph', release: '0.1.1' }]);
});

test('a release folds carried machine migrations beyond the baseline while retaining graph and journal steps', () => {
  const carried: StoreMarks = {
    'machine-store': ['20261010115509_baseline', '20261012000000_carried'],
    'host-store': STORES['host-store'],
    graph: ['decision-becomes-spec'],
    journal: ['20261010205500_place_guidance'],
  };
  const standing: StoreMarks = {
    'machine-store': ['20261010115509_baseline', '20261012000000_carried', '20261013000000_new'],
    'host-store': STORES['host-store'],
    graph: ['decision-becomes-spec', '20261017170000_new_step'],
    journal: ['20261010205500_place_guidance', '20261017171000_new_form'],
  };

  expect(unfoldedOf(standing, carried, '20261010115509_baseline')).toEqual(['20261012000000_carried']);
  expect(
    unfoldedOf({ ...standing, 'machine-store': ['20261010115509_baseline', '20261013000000_new'] }, carried, '20261010115509_baseline'),
  ).toEqual([]);
  expect(unfoldedOf(standing, carried, null)).toEqual(['20261010115509_baseline', '20261012000000_carried']);
});

test('the version after a published one raises its last number, and the first published through the feed is 0.2.0', () => {
  expect([releaseAfter(null), releaseAfter('0.1.4'), releaseAfter('0.2'), releaseAfter('1.0.9')]).toEqual([
    '0.2.0',
    '0.1.5',
    '0.2.1',
    '1.0.10',
  ]);
});
