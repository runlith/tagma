import type { HeapGraph, MapReferences, RetainerNode, SnapshotPaths } from './loadRetainers.js';

export type MapTargets = Map<number, { hiddenSelfBytes: number; targets: Set<number> }>;

const operations = new Set([
  'agentLoad.invoke',
  'agentLoad.listBoundary',
  'agentLoad.snapshot',
  'loadFeeds',
  'bench.hosted.read',
  'bench.hosted.grep',
  'bench.hosted.bash',
  'bench.hosted.glob',
  'bench.hosted.read_block',
  'call_hosted_tool',
  'ThreadEvents.project',
  'ThreadList.project',
  'ProtocolSteps.persist',
  'ProtocolSteps.stored',
  'ProtocolSteps.run',
  'ProtocolSteps.saved',
  'ProtocolOpening.configured',
  'ProtocolOpening.open',
  'ProtocolAttendance.open',
  'ProtocolAttendance.moved',
  'ThreadEvents.told',
  'ThreadEvents.start',
  'ThreadEvents.settled',
  'OwnWork.owing',
  'ThreadStorage.toldState',
  'ThreadStorage.openQuestions.seed',
  'ThreadListReads.rootWindow',
  'ThreadListReads.advanceReaderOrder',
]);
const serviceKeys = new Set(['@runlith/performance/CurrentCost', 'effect/Tracer/ParentSpan', 'effect/References/CurrentStackFrame']);

function property(graph: HeapGraph, index: number, name: string): number | undefined {
  for (let edge = graph.offsets[index]!; edge < graph.offsets[index + 1]!; edge += 1) {
    if (graph.kind(edge) === 'property' && graph.edgeName(edge) === name) return graph.target(edge);
  }
  return undefined;
}

function overlayCost(graph: HeapGraph, context: number | undefined, approved: ReadonlySet<string>) {
  const visited = new Set<number>();
  let overlay = context === undefined ? undefined : property(graph, context, 'overlay');
  while (overlay !== undefined && !visited.has(overlay) && visited.size < 16) {
    visited.add(overlay);
    const key = property(graph, overlay, 'key');
    if (key !== undefined && graph.knownKey(key, serviceKeys) === '@runlith/performance/CurrentCost') {
      const value = property(graph, overlay, 'value');
      if (value !== undefined) {
        for (let edge = graph.offsets[value]!; edge < graph.offsets[value + 1]!; edge += 1) {
          const label = graph.edgeName(edge);
          if (label !== 'Symbol(CostLedger.root)' && label !== 'CostLedger.root') continue;
          const root = graph.target(edge);
          const name = property(graph, root, 'name');
          return {
            observed: true,
            name: name === undefined ? '[unresolved]' : (graph.knownKey(name, approved) ?? '[unknown]'),
            truncated: false,
          };
        }
      }
      return { observed: true, name: '[unresolved]', truncated: false };
    }
    overlay = property(graph, overlay, 'parent');
  }
  return { observed: false, name: '[not observed]', truncated: overlay !== undefined };
}

function fiberContexts(
  graph: HeapGraph,
  all: SnapshotPaths,
  targets: MapTargets,
  approvedOperations: readonly string[],
  labels: ReadonlySet<string>,
  limit: number,
): MapReferences['fibers'] {
  const allowedOperations = new Set([...operations, ...approvedOperations]);
  const empty = () => ({ count: 0, strong: 0, weakOnly: 0, outsideAll: 0 });
  const add = (row: ReturnType<typeof empty>, index: number) => {
    row.count += 1;
    if (graph.order[index] !== 0) row.strong += 1;
    else if (all.parent[index] !== -1) row.weakOnly += 1;
    else row.outsideAll += 1;
  };
  const fibers = empty();
  const fibersWithContext = empty();
  const contexts = new Map<number, Set<number>>();
  const completed = empty();
  const ended = new Set<number>();
  const endedSpans = new Map<number, string>();
  const spanNames = new Map<
    string,
    { fibers: ReturnType<typeof empty>; completed: ReturnType<typeof empty>; completedWithoutIncoming: ReturnType<typeof empty> }
  >();
  const costObserved = empty();
  const costNotObserved = empty();
  const costNames = new Map<string, ReturnType<typeof empty>>();
  let costTruncated = 0;
  let contextEdges = 0;
  let exitObjectFibers = 0;
  let cachedSpanFibers = 0;
  for (let index = 0; index < graph.count; index += 1) {
    const node = graph.describe(index);
    if (node.type !== 'object' || node.name !== 'FiberImpl') continue;
    add(fibers, index);
    const context = property(graph, index, 'context');
    if (context !== undefined) {
      add(fibersWithContext, index);
      contextEdges += 1;
      let owners = contexts.get(context);
      if (owners === undefined) {
        owners = new Set();
        contexts.set(context, owners);
      }
      owners.add(index);
    }
    const cost = overlayCost(graph, context, allowedOperations);
    add(cost.observed ? costObserved : costNotObserved, index);
    if (cost.truncated) costTruncated += 1;
    if (cost.observed) {
      const row = costNames.get(cost.name) ?? empty();
      add(row, index);
      costNames.set(cost.name, row);
    }
    const exit = property(graph, index, '_exit');
    const hasExit = exit !== undefined && graph.describe(exit).type === 'object';
    if (hasExit) {
      exitObjectFibers += 1;
      add(completed, index);
      ended.add(index);
    }
    const cache = property(graph, index, 'cache');
    const span = cache === undefined ? undefined : property(graph, cache, 'span');
    let spanName = '[no cached PerformanceSpan]';
    if (span !== undefined && graph.describe(span).name === 'PerformanceSpan') {
      cachedSpanFibers += 1;
      const name = property(graph, span, 'name');
      spanName = name === undefined ? '[unknown]' : (graph.knownKey(name, allowedOperations) ?? '[unknown]');
    }
    const row = spanNames.get(spanName) ?? { fibers: empty(), completed: empty(), completedWithoutIncoming: empty() };
    add(row.fibers, index);
    if (hasExit) {
      add(row.completed, index);
      endedSpans.set(index, spanName);
    }
    spanNames.set(spanName, row);
  }
  const referrers = new Map<
    string,
    { sourceType: string; sourceName: string; edgeType: string; edgeName: string | null; count: number; seen: Set<number> }
  >();
  const degrees = new Map<number, number>();
  for (let source = 0; source < graph.count; source += 1) {
    let node: RetainerNode | undefined;
    for (let edge = graph.offsets[source]!; edge < graph.offsets[source + 1]!; edge += 1) {
      const target = graph.target(edge);
      if (!ended.has(target)) continue;
      node ??= graph.describe(source);
      const edgeType = graph.safeKind(edge);
      const name = graph.edgeName(edge);
      const edgeName = name !== undefined && labels.has(name) ? name : null;
      const key = JSON.stringify([node.type, node.name, edgeType, edgeName]);
      let group = referrers.get(key);
      if (group === undefined) {
        group = { sourceType: node.type, sourceName: node.name, edgeType, edgeName, count: 0, seen: new Set() };
        referrers.set(key, group);
      }
      if (!group.seen.has(target)) {
        group.seen.add(target);
        group.count += 1;
        degrees.set(target, (degrees.get(target) ?? 0) + 1);
      }
    }
  }
  const withIncoming = degrees.size;
  for (const [index, name] of endedSpans) if (!degrees.has(index)) add(spanNames.get(name)!.completedWithoutIncoming, index);
  let multipleGroups = 0;
  for (const count of degrees.values()) if (count > 1) multipleGroups += 1;
  const completedReferrers = {
    nonAdditive: true as const,
    withIncoming,
    withoutIncoming: ended.size - withIncoming,
    multipleGroups,
    groupCount: referrers.size,
    groups: [...referrers.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(({ seen: _seen, ...row }) => row),
  };
  const contextCoverage = empty();
  const cohortFibers = new Set<number>();
  const cohortContexts = new Set<number>();
  const cohortMaps = new Set<number>();
  const cohortLinks = { base: 0, flat: 0 };
  for (const [context, owners] of contexts) {
    add(contextCoverage, context);
    if (graph.describe(context).name !== 'Object') continue;
    for (let edge = graph.offsets[context]!; edge < graph.offsets[context + 1]!; edge += 1) {
      if (graph.kind(edge) !== 'property') continue;
      const name = graph.edgeName(edge);
      if (name !== 'base' && name !== '_flat') continue;
      const target = graph.target(edge);
      if (!targets.has(target)) continue;
      if (name === 'base') cohortLinks.base += 1;
      else cohortLinks.flat += 1;
      cohortMaps.add(target);
      cohortContexts.add(context);
      for (const owner of owners) cohortFibers.add(owner);
    }
  }
  let hiddenSelfBytes = 0;
  for (const map of cohortMaps) hiddenSelfBytes += targets.get(map)!.hiddenSelfBytes;
  return {
    fibers,
    fibersWithContext,
    contexts: contextCoverage,
    contextEdges,
    cohortFibers: cohortFibers.size,
    cohortContexts: cohortContexts.size,
    cohortMaps: { count: cohortMaps.size, hiddenSelfBytes },
    cohortLinks,
    exitObjectFibers,
    completed,
    completedReferrers,
    cachedSpanFibers,
    currentCost: {
      scope: 'context-overlay-only',
      observed: costObserved,
      notObserved: costNotObserved,
      truncated: costTruncated,
      names: [...costNames].map(([name, row]) => ({ name, fibers: row })).sort((a, b) => b.fibers.count - a.fibers.count),
    },
    spanNames: [...spanNames].map(([name, row]) => ({ name, ...row })).sort((a, b) => b.fibers.count - a.fibers.count),
  };
}

function mapKeys(graph: HeapGraph, targets: MapTargets): MapReferences['keys'] {
  const uninspectable = { count: 0, hiddenSelfBytes: 0 };
  const adjacent = new Map<string, { count: number; hiddenSelfBytes: number }>();
  const layout = new Map<
    string,
    { source: 'map' | 'backing'; edgeType: string; targetType: string; role: 'keyLike' | 'valueLike' | 'other'; count: number }
  >();
  const add = (table: typeof adjacent, key: string, bytes: number) => {
    const row = table.get(key) ?? { count: 0, hiddenSelfBytes: 0 };
    row.count += 1;
    row.hiddenSelfBytes += bytes;
    table.set(key, row);
  };
  for (const [index, row] of targets) {
    const nearby = new Set<string>();
    const inspect = (source: 'map' | 'backing', node: number) => {
      for (let edge = graph.offsets[node]!; edge < graph.offsets[node + 1]!; edge += 1) {
        const label = graph.edgeName(edge);
        const role =
          label !== undefined && /^(?:key(?: @\d+)?|\d+ \/ key)$/.test(label)
            ? 'keyLike'
            : label !== undefined && /^(?:value(?: @\d+)?|\d+ \/ value)$/.test(label)
              ? 'valueLike'
              : 'other';
        const target = graph.target(edge);
        const type = graph.describe(target).type;
        const edgeType = graph.safeKind(edge);
        const shape = JSON.stringify([source, edgeType, type, role]);
        const aggregate = layout.get(shape) ?? { source, edgeType, targetType: type, role, count: 0 };
        aggregate.count += 1;
        layout.set(shape, aggregate);
        const key = graph.knownKey(target, serviceKeys);
        if (key !== undefined) nearby.add(key);
      }
    };
    inspect('map', index);
    for (const target of row.targets) inspect('backing', target);
    uninspectable.count += 1;
    uninspectable.hiddenSelfBytes += row.hiddenSelfBytes;
    for (const key of nearby) add(adjacent, key, row.hiddenSelfBytes);
  }
  const rows = [...adjacent].map(([key, row]) => ({ key, ...row })).sort((a, b) => b.hiddenSelfBytes - a.hiddenSelfBytes);
  return {
    nonAdditive: true,
    entryEncoding: 'unverified',
    uninspectableMaps: uninspectable,
    adjacentKnownKeys: rows,
    layout: [...layout.values()].sort((a, b) => b.count - a.count),
  };
}

export function mapReferences(
  graph: HeapGraph,
  all: SnapshotPaths,
  targets: MapTargets,
  memberships: Uint32Array,
  limit: number,
  labels: ReadonlySet<string>,
  approvedOperations: readonly string[],
): MapReferences {
  type Link = MapReferences['largest'][number]['reverse'][number];
  type Sample = {
    node: RetainerNode;
    hiddenSelfBytes: number;
    incomingCount: number;
    reverse: Link[];
    stop: 'snapshot-root' | 'no-new-incoming' | 'limit';
    current: number;
    seen: Set<number>;
    done: boolean;
    best?: { link: Link; score: number };
  };
  const maps = { count: 0, hiddenSelfBytes: 0 };
  const weakOnly = { count: 0, hiddenSelfBytes: 0 };
  const outsideAll = { count: 0, hiddenSelfBytes: 0 };
  const withIncoming = { count: 0, hiddenSelfBytes: 0 };
  const withoutIncoming = { count: 0, hiddenSelfBytes: 0 };
  const multipleGroups = { count: 0, hiddenSelfBytes: 0 };
  const sharedTargets = { count: 0, selfBytes: 0 };
  for (let index = 0; index < graph.count; index += 1) {
    if (memberships[index]! < 2) continue;
    sharedTargets.count += 1;
    sharedTargets.selfBytes += graph.size(index);
  }
  const samples: Sample[] = [...targets]
    .sort((a, b) => b[1].hiddenSelfBytes - a[1].hiddenSelfBytes || a[0] - b[0])
    .slice(0, 5)
    .map(([index, row]) => ({
      node: graph.describe(index),
      hiddenSelfBytes: row.hiddenSelfBytes,
      incomingCount: 0,
      reverse: [],
      stop: 'limit',
      current: index,
      seen: new Set([index]),
      done: false,
    }));
  const sampled = new Map(samples.map((sample) => [sample.node.index, sample]));
  const degree = new Uint32Array(graph.count);
  const groups = new Map<
    string,
    {
      sourceType: string;
      sourceName: string;
      edgeType: string;
      edgeName: string | null;
      count: number;
      hiddenSelfBytes: number;
      seen: Set<number>;
    }
  >();
  const linkOf = (source: RetainerNode, edge: number): Link => {
    const name = graph.edgeName(edge);
    return { source, edgeType: graph.safeKind(edge), edgeName: name !== undefined && labels.has(name) ? name : null };
  };
  const consider = (sample: Sample, link: Link) => {
    if (sample.seen.has(link.source.index)) return;
    const named =
      (link.source.type === 'object' || link.source.type === 'native') && link.source.name !== 'Object' && link.source.name !== 'Array';
    const score =
      (link.source.index === 0 ? 100 : 0) + (named ? 10 : 0) + (link.edgeName !== null ? 2 : 0) + (link.edgeType !== 'weak' ? 1 : 0);
    if (
      sample.best === undefined ||
      score > sample.best.score ||
      (score === sample.best.score && link.source.index < sample.best.link.source.index)
    )
      sample.best = { link, score };
  };
  for (let source = 0; source < graph.count; source += 1) {
    let node: RetainerNode | undefined;
    for (let edge = graph.offsets[source]!; edge < graph.offsets[source + 1]!; edge += 1) {
      const target = graph.target(edge);
      const weight = targets.get(target);
      if (weight === undefined) continue;
      node ??= graph.describe(source);
      const link = linkOf(node, edge);
      const key = JSON.stringify([node.type, node.name, link.edgeType, link.edgeName]);
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          sourceType: node.type,
          sourceName: node.name,
          edgeType: link.edgeType,
          edgeName: link.edgeName,
          count: 0,
          hiddenSelfBytes: 0,
          seen: new Set(),
        };
        groups.set(key, group);
      }
      if (!group.seen.has(target)) {
        group.seen.add(target);
        group.count += 1;
        group.hiddenSelfBytes += weight.hiddenSelfBytes;
        degree[target] = degree[target]! + 1;
      }
      const sample = sampled.get(target);
      if (sample !== undefined) {
        sample.incomingCount += 1;
        consider(sample, link);
      }
    }
  }
  for (const [index, weight] of targets) {
    maps.count += 1;
    maps.hiddenSelfBytes += weight.hiddenSelfBytes;
    const root = all.parent[index] !== -1 ? weakOnly : outsideAll;
    root.count += 1;
    root.hiddenSelfBytes += weight.hiddenSelfBytes;
    const covered = degree[index] === 0 ? withoutIncoming : withIncoming;
    covered.count += 1;
    covered.hiddenSelfBytes += weight.hiddenSelfBytes;
    if (degree[index]! > 1) {
      multipleGroups.count += 1;
      multipleGroups.hiddenSelfBytes += weight.hiddenSelfBytes;
    }
  }
  for (let depth = 0; depth < 6; depth += 1) {
    if (depth > 0) {
      const frontier = new Map<number, Sample[]>();
      for (const sample of samples)
        if (!sample.done) {
          const rows = frontier.get(sample.current) ?? [];
          rows.push(sample);
          frontier.set(sample.current, rows);
        }
      if (frontier.size === 0) break;
      for (let source = 0; source < graph.count; source += 1) {
        let node: RetainerNode | undefined;
        for (let edge = graph.offsets[source]!; edge < graph.offsets[source + 1]!; edge += 1) {
          const rows = frontier.get(graph.target(edge));
          if (rows === undefined) continue;
          node ??= graph.describe(source);
          const link = linkOf(node, edge);
          for (const sample of rows) consider(sample, link);
        }
      }
    }
    for (const sample of samples) {
      if (sample.done) continue;
      if (sample.best === undefined) {
        sample.stop = 'no-new-incoming';
        sample.done = true;
        continue;
      }
      const link = sample.best.link;
      sample.best = undefined;
      sample.reverse.push(link);
      sample.current = link.source.index;
      sample.seen.add(sample.current);
      if (sample.current === 0) {
        sample.stop = 'snapshot-root';
        sample.done = true;
      }
    }
  }
  const ranked = [...groups.values()].sort((a, b) => b.hiddenSelfBytes - a.hiddenSelfBytes || b.count - a.count).slice(0, limit);
  return {
    nonAdditiveGroups: true,
    fibers: fiberContexts(graph, all, targets, approvedOperations, labels, limit),
    keys: mapKeys(graph, targets),
    maps,
    weakOnly,
    outsideAll,
    withIncoming,
    withoutIncoming,
    multipleGroups,
    sharedTargets,
    groupCount: groups.size,
    groups: ranked.map(({ seen: _seen, ...row }) => row),
    largest: samples.map(({ current: _current, seen: _seen, done: _done, best: _best, ...sample }) => sample),
  };
}
