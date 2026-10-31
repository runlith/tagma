import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRetainers, loadRetainers } from './loadRetainers.js';

test('retainers follow strong dominators with shared ownership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retainers-'));
  try {
    const fields = ['type', 'name', 'self_size', 'edge_count'];
    const nodes = [
      [0, 0, 0, 3],
      [1, 1, 1, 2],
      [1, 2, 2, 1],
      [1, 3, 3, 2],
      [1, 4, 4, 1],
      [1, 5, 5, 0],
      [2, 6, 6, 0],
      [3, 7, 7, 0],
      [4, 8, 1, 1],
      [5, 9, 2, 1],
      [3, 10, 1000, 0],
    ];
    const edges = [
      [0, 1],
      [0, 2],
      [0, 8],
      [0, 3],
      [0, 4],
      [0, 3],
      [0, 6],
      [0, 7],
      [1, 5],
      [0, 9],
      [0, 10],
    ].flatMap(([type, target]) => [type, 0, target! * fields.length]);
    const snapshot = {
      snapshot: {
        meta: {
          node_fields: fields,
          node_types: [['synthetic', 'object', 'native', 'string', 'closure', 'array'], 'string', 'number', 'number'],
          edge_fields: ['type', 'name_or_index', 'to_node'],
          edge_types: [['property', 'weak'], 'string_or_number', 'node'],
        },
      },
      nodes: nodes.flat(),
      edges,
      strings: ['root', 'A', 'B', 'C', 'D', 'E', 'F', 'secret application text', 'secret closure', 'secret array', 'secret large text'],
    };
    const file = join(dir, 'sample.heapsnapshot');
    await writeFile(file, JSON.stringify(snapshot));
    const result = await loadRetainers(file, 10);
    expect(result.nonAdditive).toBe(true);
    expect(result.reachable).toBe(10);
    expect(result.rows.map(({ name, retainedBytes }) => [name, retainedBytes])).toEqual([
      ['[closure]', 1003],
      ['[array]', 1002],
      ['[string]', 1000],
      ['C', 16],
      ['[string]', 7],
      ['F', 6],
      ['A', 5],
      ['D', 4],
      ['B', 2],
    ]);
    expect(result.rows.find((row) => row.type === 'array')?.dominators.map((node) => node.name)).toEqual(['[closure]', '[synthetic]']);
    expect(result.rows.find((row) => row.name === 'C')?.dominators.map((node) => node.type)).toEqual(['synthetic']);
    expect(result.rows.find((row) => row.name === 'F')?.dominators.map((node) => node.name)).toEqual(['C', '[synthetic]']);
    expect(JSON.stringify(result)).not.toContain('secret');
    const already = new AbortController();
    already.abort();
    await expect(loadRetainers(file, 10, already.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const pending = new AbortController();
    const reading = loadRetainers(file, 10, pending.signal);
    pending.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('compares complete class counts and finds filtered strong paths without exposing heap values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retainer-comparison-'));
  try {
    const fields = ['type', 'name', 'self_size', 'edge_count'];
    const strings = [
      'root',
      'BenchOwner',
      'ProductOwner',
      'Growing',
      'BigOwner',
      'secret-application-value',
      'world',
      'bookkeeping',
      'owner',
      'secret-property-token',
    ];
    const snapshot = (loaded: boolean) => {
      const nodes = loaded
        ? [
            [0, 0, 0, 3],
            [1, 1, 5, 4],
            [1, 2, 5, 5],
            [1, 3, 10, 1],
            [1, 3, 12, 0],
            [2, 5, 50, 0],
            [1, 3, 14, 0],
            [1, 3, 16, 0],
            [1, 4, 100, 0],
            [2, 5, 19, 0],
            [0, 0, 0, 2],
            [1, 4, 7, 0],
            [3, 5, 1000, 0],
            [3, 5, 500, 0],
            [3, 5, 200, 0],
          ]
        : [
            [0, 0, 0, 2],
            [1, 1, 5, 1],
            [1, 2, 5, 1],
            [1, 3, 10, 0],
          ];
      const edges = loaded
        ? [
            [0, 6, 1],
            [0, 6, 2],
            [0, 6, 8],
            [0, 7, 3],
            [0, 7, 6],
            [1, 7, 7],
            [1, 7, 12],
            [0, 8, 3],
            [0, 8, 4],
            [1, 8, 12],
            [1, 8, 12],
            [1, 8, 13],
            [0, 9, 5],
            [0, 6, 11],
            [0, 6, 12],
          ]
        : [
            [0, 6, 1],
            [0, 6, 2],
            [0, 7, 3],
            [0, 8, 3],
          ];
      return JSON.stringify({
        snapshot: {
          meta: {
            node_fields: fields,
            node_types: [['synthetic', 'object', 'string', 'hidden'], 'string', 'number', 'number'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['property', 'weak'], 'string_or_number', 'node'],
          },
        },
        nodes: nodes.flat(),
        edges: edges.flatMap(([type, name, target]) => [type, name, target! * fields.length]),
        strings,
      });
    };
    const before = join(dir, 'before.heapsnapshot');
    const after = join(dir, 'after.heapsnapshot');
    await writeFile(before, snapshot(false));
    await writeFile(after, snapshot(true));
    const result = await compareRetainers(before, after, { limit: 5, labels: ['owner'], excludeLabels: ['bookkeeping'] });
    expect(result.nonAdditiveRetainedBytes).toBe(true);
    expect(result.dominatorsOn).toBe('unfiltered-strong-graph');
    expect(result.weakEdgesProveRetention).toBe(false);
    expect(result.syntheticNodesProveRoots).toBe(false);
    expect(result.otherSyntheticSeeds).toEqual({ before: 0, after: 1 });
    expect(result.before).toMatchObject({ count: 4, selfBytes: 20, outsideCount: 0, outsideSelfBytes: 0 });
    expect(result.after).toMatchObject({
      count: 15,
      selfBytes: 1938,
      outsideCount: 7,
      outsideSelfBytes: 1742,
      weakOnlyCount: 3,
      weakOnlySelfBytes: 1516,
      outsideAllCount: 4,
      outsideAllSelfBytes: 226,
      otherSyntheticCount: 2,
      otherSyntheticSelfBytes: 7,
      outsideSyntheticCount: 2,
      outsideSyntheticSelfBytes: 219,
    });
    expect(result.pathWalk).toEqual({ reachable: 7, excludedEdges: 2, excludedLabels: ['bookkeeping'], excludedNodes: [] });
    expect(result.bySize[0]?.name).toBe('[hidden]');
    const growing = result.byCount.find(({ name }) => name === 'Growing')!;
    expect(growing.before).toMatchObject({ count: 1, selfBytes: 10, outsideCount: 0, outsideSelfBytes: 0 });
    expect(growing.after).toMatchObject({
      count: 4,
      selfBytes: 52,
      outsideCount: 1,
      outsideSelfBytes: 16,
      weakOnlyCount: 1,
      weakOnlySelfBytes: 16,
    });
    expect([growing.countDelta, growing.selfBytesDelta, growing.pathCount]).toEqual([3, 42, 2]);
    expect(growing.examples.map(({ retainedBytes }) => retainedBytes)).toEqual([60, 12]);
    expect(growing.examples[0]?.dominators.map(({ node }) => node.name)).toEqual(['[synthetic]']);
    expect(growing.examples[1]?.dominators.map(({ node }) => node.name)).toEqual(['ProductOwner', '[synthetic]']);
    expect(growing.examples[0]?.path.map(({ node, edgeName }) => [node.name, edgeName])).toEqual([
      ['[synthetic]', null],
      ['ProductOwner', 'world'],
      ['Growing', 'owner'],
    ]);
    expect(growing.weakExamples[0]?.path.map(({ edgeType }) => edgeType)).toEqual([null, 'property', 'weak']);
    expect(result.outsideHidden.before.targets).toEqual({ count: 0, selfBytes: 0 });
    expect(result.outsideHidden.after.nonAdditiveGroups).toBe(true);
    expect(result.outsideHidden.after.targets).toEqual({ count: 3, selfBytes: 1700 });
    expect(result.outsideHidden.after.withIncoming).toEqual({ count: 2, selfBytes: 1500 });
    expect(result.outsideHidden.after.withoutIncoming).toEqual({ count: 1, selfBytes: 200 });
    expect(result.outsideHidden.after.multipleGroups).toEqual({ count: 1, selfBytes: 1000 });
    expect(
      result.outsideHidden.after.groups.find(({ sourceName, edgeType }) => sourceName === 'ProductOwner' && edgeType === 'weak'),
    ).toMatchObject({ count: 2, selfBytes: 1500 });
    expect(result.outsideHidden.after.largest[0]?.incomingCount).toBe(4);
    expect(result.outsideHidden.after.largest[0]?.incoming.map(({ source, edgeType }) => [source.name, edgeType])).toEqual([
      ['BenchOwner', 'weak'],
      ['ProductOwner', 'weak'],
      ['ProductOwner', 'weak'],
      ['[synthetic]', 'property'],
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    const withoutBench = await compareRetainers(before, after, { limit: 5, labels: ['owner'], excludeNodes: [1] });
    expect(withoutBench.pathWalk).toEqual({ reachable: 6, excludedEdges: 1, excludedLabels: [], excludedNodes: [1] });
    expect(withoutBench.byCount.find(({ name }) => name === 'Growing')?.pathCount).toBe(2);
    expect(withoutBench.byCount.find(({ name }) => name === 'Growing')?.after).toEqual(growing.after);
    const reversed = await compareRetainers(after, before, { limit: 5 });
    expect(reversed.decreasedByCount.find(({ name }) => name === 'Growing')?.countDelta).toBe(-3);
    const deep = join(dir, 'deep.heapsnapshot');
    await writeFile(
      deep,
      JSON.stringify({
        snapshot: {
          meta: {
            node_fields: fields,
            node_types: [['synthetic', 'object'], 'string', 'number', 'number'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['property'], 'string_or_number', 'node'],
          },
        },
        nodes: [[0, 0, 0, 1], ...Array.from({ length: 47 }, () => [1, 1, 1, 1]), [1, 2, 100, 0]].flat(),
        edges: Array.from({ length: 48 }, (_, index) => [0, 3, (index + 1) * fields.length]).flat(),
        strings: ['root', 'Chain', 'Deep', 'next'],
      }),
    );
    const deepResult = await compareRetainers(before, deep, { limit: 5 });
    const deepPath = deepResult.bySize.find(({ name }) => name === 'Deep')?.examples[0];
    expect(deepPath?.truncated).toBe(true);
    expect(deepPath?.path).toHaveLength(48);
    expect(deepPath?.dominatorsTruncated).toBe(true);
    await expect(compareRetainers(before, after, { limit: 0 })).rejects.toThrow();
    await expect(compareRetainers(before, after, { limit: 1, labels: ['secret-property-token'] })).rejects.toThrow();
    await expect(compareRetainers(before, join(dir, 'missing'), { limit: 1 })).rejects.toThrow('heap retainer analysis failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('weights incoming Map references by unique outside-hidden targets and reports overlap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'map-referrers-'));
  try {
    const fields = ['type', 'name', 'self_size', 'edge_count'];
    const strings = ['root', 'Product', 'Map', 'secret-hidden-payload', 'Manager', 'world', 'weak', 'storage'];
    const make = (nodes: number[][], edges: number[][]) =>
      JSON.stringify({
        snapshot: {
          meta: {
            node_fields: fields,
            node_types: [['synthetic', 'object', 'hidden'], 'string', 'number', 'number'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['property', 'weak', 'internal'], 'string_or_number', 'node'],
          },
        },
        nodes: nodes.flat(),
        edges: edges.flatMap(([type, name, target]) => [type, name, target! * fields.length]),
        strings,
      });
    const before = join(dir, 'before.heapsnapshot');
    const after = join(dir, 'after.heapsnapshot');
    await writeFile(before, make([[0, 0, 0, 0]], []));
    await writeFile(
      after,
      make(
        [
          [0, 0, 0, 3],
          [1, 1, 1, 3],
          [1, 1, 1, 1],
          [1, 2, 1, 2],
          [2, 3, 100, 0],
          [1, 2, 1, 1],
          [1, 2, 1, 1],
          [2, 3, 50, 0],
          [1, 4, 1, 1],
        ],
        [
          [0, 5, 1],
          [0, 5, 2],
          [0, 5, 8],
          [1, 6, 3],
          [1, 6, 3],
          [1, 6, 5],
          [1, 6, 3],
          [2, 7, 4],
          [2, 7, 4],
          [2, 7, 4],
          [2, 7, 7],
          [1, 6, 3],
        ],
      ),
    );
    const result = await compareRetainers(before, after, { limit: 10 });
    const hidden = result.outsideHidden.after;
    expect(hidden.targets).toEqual({ count: 2, selfBytes: 150 });
    expect(hidden.groups.find(({ sourceName }) => sourceName === 'Map')).toMatchObject({ count: 2, selfBytes: 150 });
    const maps = hidden.mapReferrers;
    expect(maps.nonAdditiveGroups).toBe(true);
    expect(maps.maps).toEqual({ count: 3, hiddenSelfBytes: 250 });
    expect(maps.sharedTargets).toEqual({ count: 1, selfBytes: 100 });
    expect(maps.weakOnly).toEqual({ count: 2, hiddenSelfBytes: 200 });
    expect(maps.outsideAll).toEqual({ count: 1, hiddenSelfBytes: 50 });
    expect(maps.withIncoming).toEqual({ count: 2, hiddenSelfBytes: 200 });
    expect(maps.withoutIncoming).toEqual({ count: 1, hiddenSelfBytes: 50 });
    expect(maps.multipleGroups).toEqual({ count: 1, hiddenSelfBytes: 100 });
    expect(maps.groups.find(({ sourceName }) => sourceName === 'Product')).toMatchObject({
      edgeType: 'weak',
      edgeName: null,
      count: 2,
      hiddenSelfBytes: 200,
    });
    expect(maps.groups.find(({ sourceName }) => sourceName === 'Manager')).toMatchObject({
      edgeType: 'weak',
      count: 1,
      hiddenSelfBytes: 100,
    });
    expect(maps.largest[0]?.incomingCount).toBe(4);
    expect(maps.largest[0]?.reverse.map(({ source, edgeType }) => [source.name, edgeType])).toEqual([
      ['Product', 'weak'],
      ['[synthetic]', 'property'],
    ]);
    expect(maps.largest[0]?.stop).toBe('snapshot-root');
    expect(maps.largest[2]?.stop).toBe('no-new-incoming');
    expect(JSON.stringify(result)).not.toContain('secret');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('counts fiber context links and does not mistake Map properties for keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fiber-retainers-'));
  try {
    const fields = ['type', 'name', 'self_size', 'edge_count'];
    const strings = [
      'root',
      'FiberImpl',
      'Object',
      'Map',
      'PerformanceSpan',
      'ThreadEvents.told',
      'ProtocolAttendance.open',
      'secret-hidden',
      '@runlith/performance/CurrentCost',
      'secret-key',
      'context',
      'cache',
      'span',
      'name',
      'base',
      '_flat',
      '_exit',
      'key @0',
      'key @1',
      'storage',
      'overlay',
      'key',
      'value',
      'Symbol(CostLedger.root)',
      'bench.hosted.read',
    ];
    const make = (nodes: number[][], edges: number[][]) =>
      JSON.stringify({
        snapshot: {
          meta: {
            node_fields: fields,
            node_types: [['synthetic', 'object', 'string', 'hidden'], 'string', 'number', 'number'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['property', 'weak', 'internal'], 'string_or_number', 'node'],
          },
        },
        nodes: nodes.flat(),
        edges: edges.flatMap(([type, name, target]) => [type, name, target! * fields.length]),
        strings,
      });
    const before = join(dir, 'before.heapsnapshot');
    const after = join(dir, 'after.heapsnapshot');
    await writeFile(before, make([[0, 0, 0, 0]], []));
    await writeFile(
      after,
      make(
        [
          [0, 0, 0, 2],
          [1, 1, 1, 3],
          [1, 1, 1, 2],
          [1, 2, 1, 0],
          [1, 2, 1, 3],
          [1, 2, 1, 1],
          [1, 2, 1, 1],
          [1, 4, 1, 1],
          [1, 4, 1, 1],
          [2, 6, 1, 0],
          [2, 5, 1, 0],
          [1, 2, 1, 0],
          [1, 3, 1, 3],
          [3, 7, 100, 0],
          [2, 8, 1, 0],
          [2, 9, 1, 0],
          [1, 2, 1, 2],
          [1, 2, 1, 1],
          [1, 2, 1, 1],
          [2, 24, 1, 0],
        ],
        [
          [0, 10, 1],
          [1, 10, 2],
          [0, 10, 3],
          [0, 11, 5],
          [0, 16, 11],
          [0, 10, 4],
          [0, 11, 6],
          [0, 14, 12],
          [0, 15, 12],
          [0, 20, 16],
          [0, 12, 7],
          [0, 12, 8],
          [0, 13, 9],
          [0, 13, 10],
          [2, 19, 13],
          [0, 17, 14],
          [0, 18, 15],
          [0, 21, 14],
          [0, 22, 17],
          [0, 23, 18],
          [0, 13, 19],
        ],
      ),
    );
    const result = await compareRetainers(before, after, { limit: 10 });
    const maps = result.outsideHidden.after.mapReferrers;
    expect(maps.fibers.fibers).toEqual({ count: 2, strong: 1, weakOnly: 1, outsideAll: 0 });
    expect(maps.fibers.fibersWithContext.count).toBe(2);
    expect(maps.fibers.contexts.count).toBe(2);
    expect([maps.fibers.cohortFibers, maps.fibers.cohortContexts]).toEqual([1, 1]);
    expect(maps.fibers.cohortMaps).toEqual({ count: 1, hiddenSelfBytes: 100 });
    expect(maps.fibers.cohortLinks).toEqual({ base: 1, flat: 1 });
    expect(maps.fibers.exitObjectFibers).toBe(1);
    expect(maps.fibers.currentCost.scope).toBe('context-overlay-only');
    expect(maps.fibers.currentCost.observed.weakOnly).toBe(1);
    expect(maps.fibers.currentCost.notObserved.strong).toBe(1);
    expect(maps.fibers.currentCost.names[0]).toMatchObject({ name: 'bench.hosted.read', fibers: { count: 1 } });
    expect(maps.fibers.completed).toEqual({ count: 1, strong: 1, weakOnly: 0, outsideAll: 0 });
    expect(maps.fibers.completedReferrers).toMatchObject({ withIncoming: 1, withoutIncoming: 0, multipleGroups: 0 });
    expect(maps.fibers.completedReferrers.groups[0]).toMatchObject({ sourceType: 'synthetic', edgeType: 'property', count: 1 });
    expect(maps.fibers.spanNames.find(({ name }) => name === 'ThreadEvents.told')?.fibers.weakOnly).toBe(1);
    expect(maps.fibers.spanNames.find(({ name }) => name === 'ProtocolAttendance.open')?.completed.strong).toBe(1);
    expect(maps.fibers.spanNames.find(({ name }) => name === 'ProtocolAttendance.open')?.completedWithoutIncoming.count).toBe(0);
    expect(maps.keys.entryEncoding).toBe('unverified');
    expect(maps.keys.uninspectableMaps).toEqual({ count: 1, hiddenSelfBytes: 100 });
    expect(maps.keys.adjacentKnownKeys).toEqual([{ key: '@runlith/performance/CurrentCost', count: 1, hiddenSelfBytes: 100 }]);
    expect(maps.keys.layout.find(({ role }) => role === 'keyLike')?.count).toBe(2);
    expect(JSON.stringify(result)).not.toContain('secret');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
