import { parentPort, workerData } from 'node:worker_threads';
import type {
  HeapGraph,
  HiddenReferences,
  RetainerClass,
  RetainerComparison,
  RetainerCount,
  RetainerNode,
  RetainerPath,
  RetainerRequest,
  RetainerRow,
  RetainerStep,
  RetainerSummary,
  SnapshotPaths,
  WeakPath,
} from './loadRetainers.js';
import { mapReferences } from './loadRetainers.references.js';
import type { MapTargets } from './loadRetainers.references.js';

type Snapshot = {
  snapshot: {
    meta: { node_fields: string[]; node_types: (string | string[])[]; edge_fields: string[]; edge_types: (string | string[])[] };
  };
  nodes: number[];
  edges: number[];
  strings: string[];
};

type Graph = HeapGraph;
type MutableCount = { -readonly [K in keyof RetainerCount]: RetainerCount[K] };
type Census = { total: MutableCount; classes: Map<string, { type: string; name: string; stats: MutableCount }> };

const nodeKinds = new Set([
  'hidden',
  'array',
  'string',
  'object',
  'code',
  'closure',
  'regexp',
  'number',
  'native',
  'synthetic',
  'concatenated string',
  'sliced string',
  'symbol',
  'bigint',
  'object shape',
]);
const edgeKinds = new Set(['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak', 'invisible']);
const defaultLabels = [
  '__proto__',
  'prototype',
  'constructor',
  'next',
  'value',
  'values',
  'head',
  'tail',
  'root',
  'parent',
  'children',
  'current',
  'entries',
  'keys',
  'data',
  'state',
  'ref',
  'context',
  'scope',
  'stack',
  'frames',
  'fiber',
  'fibers',
  'queue',
  'items',
  'buffer',
  'array',
  'map',
  'set',
  'table',
  'objects',
  'world',
  'runtime',
  'owners',
  'ledger',
  'events',
  'calls',
  'following',
  'aggregatedCosts',
  'probe',
  'probes',
  'streams',
  'feeds',
  'born',
];

function graphOf(snapshot: Snapshot): HeapGraph {
  const meta = snapshot.snapshot.meta;
  const nf = meta.node_fields;
  const ef = meta.edge_fields;
  const typeAt = nf.indexOf('type');
  const nameAt = nf.indexOf('name');
  const sizeAt = nf.indexOf('self_size');
  const countAt = nf.indexOf('edge_count');
  const edgeTypeAt = ef.indexOf('type');
  const edgeNameAt = ef.indexOf('name_or_index');
  const targetAt = ef.indexOf('to_node');
  const nodeTypes = meta.node_types[typeAt];
  const edgeTypes = meta.edge_types[edgeTypeAt];
  if (
    [typeAt, nameAt, sizeAt, countAt, edgeTypeAt, edgeNameAt, targetAt].some((i) => i < 0) ||
    !Array.isArray(nodeTypes) ||
    !Array.isArray(edgeTypes) ||
    nodeTypes.some((type) => !nodeKinds.has(type))
  )
    throw new Error('invalid metadata');
  const nodes = snapshot.nodes;
  const edges = snapshot.edges;
  if (!nf.length || !ef.length || nodes.length % nf.length || edges.length % ef.length) throw new Error('invalid heap');
  const count = nodes.length / nf.length;
  const edgeCount = edges.length / ef.length;
  if (!count) throw new Error('empty heap');
  const offsets = new Uint32Array(count + 1);
  for (let n = 0; n < count; n += 1) {
    const length = nodes[n * nf.length + countAt]!;
    if (!Number.isSafeInteger(length) || length < 0 || offsets[n]! + length > edgeCount) throw new Error('invalid edges');
    offsets[n + 1] = offsets[n]! + length;
  }
  if (offsets[count] !== edgeCount) throw new Error('invalid edge count');
  const weak = edgeTypes.indexOf('weak');
  const target = (edge: number): number => {
    const offset = edges[edge * ef.length + targetAt]!;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % nf.length || offset >= nodes.length) throw new Error('invalid target');
    return offset / nf.length;
  };
  const strong = (edge: number): boolean => edges[edge * ef.length + edgeTypeAt] !== weak;
  const kind = (edge: number): string => {
    const name = edgeTypes[edges[edge * ef.length + edgeTypeAt]!];
    if (name === undefined) throw new Error('invalid edge type');
    return name;
  };
  const safeKind = (edge: number): string => {
    const type = kind(edge);
    return edgeKinds.has(type) ? type : '[edge]';
  };
  const edgeName = (edge: number): string | undefined => {
    const type = kind(edge);
    if (type !== 'context' && type !== 'property' && type !== 'internal' && type !== 'shortcut') return undefined;
    return snapshot.strings[edges[edge * ef.length + edgeNameAt]!];
  };
  const knownKey = (index: number, keys: ReadonlySet<string>): string | undefined => {
    const type = nodeTypes[nodes[index * nf.length + typeAt]!];
    if (type !== 'string') return undefined;
    const name = snapshot.strings[nodes[index * nf.length + nameAt]!];
    return name !== undefined && keys.has(name) ? name : undefined;
  };
  const describe = (index: number): RetainerNode => {
    const type = nodeTypes[nodes[index * nf.length + typeAt]!];
    const rawName = snapshot.strings[nodes[index * nf.length + nameAt]!];
    if (type === undefined || rawName === undefined) throw new Error('invalid node');
    const name = type === 'object' || type === 'native' ? rawName : `[${type}]`;
    return { index, type, name };
  };
  const size = (index: number): number => {
    const value = nodes[index * nf.length + sizeAt]!;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid size');
    return value;
  };
  const order = new Int32Array(count);
  const vertex = new Int32Array(count + 1);
  const parent = new Int32Array(count + 1);
  const stackNodes = new Int32Array(count);
  const stackEdges = new Uint32Array(count);
  let found = 1;
  order[0] = 1;
  vertex[1] = 0;
  stackNodes[0] = 0;
  stackEdges[0] = offsets[0]!;
  let top = 0;
  while (top >= 0) {
    const node = stackNodes[top]!;
    const edge = stackEdges[top]!;
    if (edge >= offsets[node + 1]!) {
      top -= 1;
      continue;
    }
    stackEdges[top] = edge + 1;
    if (!strong(edge)) continue;
    const next = target(edge);
    if (order[next] !== 0) continue;
    found += 1;
    order[next] = found;
    vertex[found] = next;
    parent[found] = order[node]!;
    top += 1;
    stackNodes[top] = next;
    stackEdges[top] = offsets[next]!;
  }
  return { count, edgeCount, offsets, target, strong, kind, safeKind, edgeName, knownKey, describe, size, order, vertex, parent, found };
}

function dominators(graph: Graph) {
  const { edgeCount, offsets, strong, target, order, vertex, parent, found, size } = graph;
  const pred = new Int32Array(found + 1).fill(-1);
  const predNext = new Int32Array(edgeCount);
  const predFrom = new Int32Array(edgeCount);
  let used = 0;
  for (let i = 1; i <= found; i += 1) {
    const node = vertex[i]!;
    for (let e = offsets[node]!; e < offsets[node + 1]!; e += 1) {
      if (!strong(e)) continue;
      const dest = order[target(e)]!;
      predFrom[used] = i;
      predNext[used] = pred[dest]!;
      pred[dest] = used++;
    }
  }
  const semi = new Int32Array(found + 1);
  const ancestor = new Int32Array(found + 1);
  const label = new Int32Array(found + 1);
  const idom = new Int32Array(found + 1);
  const buckets = new Int32Array(found + 1);
  const bucketNext = new Int32Array(found + 1);
  const path = new Int32Array(found + 1);
  for (let i = 1; i <= found; i += 1) semi[i] = label[i] = i;
  const evaluate = (v: number): number => {
    if (ancestor[v] === 0) return label[v]!;
    let at = v;
    let length = 0;
    while (ancestor[ancestor[at]!] !== 0) {
      path[length++] = at;
      at = ancestor[at]!;
    }
    while (length > 0) {
      const item = path[--length]!;
      const above = ancestor[item]!;
      if (semi[label[above]!]! < semi[label[item]!]!) label[item] = label[above]!;
      ancestor[item] = ancestor[above]!;
    }
    return label[v]!;
  };
  for (let w = found; w >= 2; w -= 1) {
    for (let p = pred[w]!; p !== -1; p = predNext[p]!) {
      const u = evaluate(predFrom[p]!);
      semi[w] = Math.min(semi[w]!, semi[u]!);
    }
    bucketNext[w] = buckets[semi[w]!]!;
    buckets[semi[w]!] = w;
    ancestor[w] = parent[w]!;
    const par = parent[w]!;
    for (let v = buckets[par]!; v !== 0; v = bucketNext[v]!) {
      const u = evaluate(v);
      idom[v] = semi[u]! < semi[v]! ? u : par;
    }
    buckets[par] = 0;
  }
  for (let w = 2; w <= found; w += 1) if (idom[w] !== semi[w]) idom[w] = idom[idom[w]!]!;
  const retained = new Float64Array(found + 1);
  for (let i = 1; i <= found; i += 1) retained[i] = size(vertex[i]!);
  for (let i = found; i >= 2; i -= 1) {
    const parent = idom[i]!;
    retained[parent] = retained[parent]! + retained[i]!;
  }
  return { idom, retained };
}

function summarize(graph: Graph, limit: number): RetainerSummary {
  const { idom, retained } = dominators(graph);
  const { found, vertex, describe, size } = graph;
  const candidates: number[] = [];
  for (let i = 2; i <= found; i += 1) candidates.push(i);
  candidates.sort((a, b) => retained[b]! - retained[a]! || vertex[a]! - vertex[b]!);
  const rows: RetainerRow[] = candidates.slice(0, limit).map((i) => {
    const chain: RetainerNode[] = [];
    for (let p = idom[i]!; p !== 0; p = idom[p]!) chain.push(describe(vertex[p]!));
    return { ...describe(vertex[i]!), selfBytes: size(vertex[i]!), retainedBytes: retained[i]!, dominators: chain };
  });
  return { nonAdditive: true, reachable: found, rows };
}

const emptyCount = (): MutableCount => ({
  count: 0,
  selfBytes: 0,
  outsideCount: 0,
  outsideSelfBytes: 0,
  weakOnlyCount: 0,
  weakOnlySelfBytes: 0,
  outsideAllCount: 0,
  outsideAllSelfBytes: 0,
  otherSyntheticCount: 0,
  otherSyntheticSelfBytes: 0,
  outsideSyntheticCount: 0,
  outsideSyntheticSelfBytes: 0,
});
const classKey = (node: RetainerNode): string => `${node.type}\0${node.name}`;

function allPaths(graph: Graph): SnapshotPaths {
  const parent = new Int32Array(graph.count).fill(-1);
  const via = new Int32Array(graph.count).fill(-1);
  const queue = new Int32Array(graph.count);
  let length = 1;
  parent[0] = 0;
  for (let cursor = 0; cursor < length; cursor += 1) {
    const node = queue[cursor]!;
    for (let edge = graph.offsets[node]!; edge < graph.offsets[node + 1]!; edge += 1) {
      const next = graph.target(edge);
      if (parent[next] !== -1) continue;
      parent[next] = node;
      via[next] = edge;
      queue[length++] = next;
    }
  }
  const synthetic = new Uint8Array(graph.count);
  length = 0;
  for (let index = 0; index < graph.count; index += 1) {
    if (parent[index] !== -1) synthetic[index] = 1;
    else if (graph.describe(index).type === 'synthetic') {
      synthetic[index] = 1;
      queue[length++] = index;
    }
  }
  const syntheticSeeds = length;
  for (let cursor = 0; cursor < length; cursor += 1) {
    const node = queue[cursor]!;
    for (let edge = graph.offsets[node]!; edge < graph.offsets[node + 1]!; edge += 1) {
      const next = graph.target(edge);
      if (synthetic[next] !== 0) continue;
      synthetic[next] = 1;
      queue[length++] = next;
    }
  }
  return { parent, via, synthetic, syntheticSeeds };
}

function census(graph: Graph, all: ReturnType<typeof allPaths>): Census {
  const total = emptyCount();
  const classes: Census['classes'] = new Map();
  for (let index = 0; index < graph.count; index += 1) {
    const node = graph.describe(index);
    const key = classKey(node);
    let row = classes.get(key);
    if (row === undefined) {
      row = { type: node.type, name: node.name, stats: emptyCount() };
      classes.set(key, row);
    }
    const bytes = graph.size(index);
    const outside = graph.order[index] === 0;
    for (const stats of [total, row.stats]) {
      stats.count += 1;
      stats.selfBytes += bytes;
      if (!Number.isSafeInteger(stats.selfBytes)) throw new Error('invalid total');
      if (outside) {
        stats.outsideCount += 1;
        stats.outsideSelfBytes += bytes;
        if (all.parent[index] !== -1) {
          stats.weakOnlyCount += 1;
          stats.weakOnlySelfBytes += bytes;
        } else {
          stats.outsideAllCount += 1;
          stats.outsideAllSelfBytes += bytes;
          if (all.synthetic[index] !== 0) {
            stats.otherSyntheticCount += 1;
            stats.otherSyntheticSelfBytes += bytes;
          } else {
            stats.outsideSyntheticCount += 1;
            stats.outsideSyntheticSelfBytes += bytes;
          }
        }
      }
    }
  }
  return { total, classes };
}

function pathWalk(graph: Graph, excluded: ReadonlySet<string>, excludedNodes: ReadonlySet<number>) {
  const parent = new Int32Array(graph.count).fill(-1);
  const via = new Int32Array(graph.count).fill(-1);
  const queue = new Int32Array(graph.found);
  const counts = new Map<string, number>();
  let length = 1;
  let excludedEdges = 0;
  parent[0] = 0;
  for (let cursor = 0; cursor < length; cursor += 1) {
    const node = queue[cursor]!;
    const key = classKey(graph.describe(node));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    for (let edge = graph.offsets[node]!; edge < graph.offsets[node + 1]!; edge += 1) {
      if (!graph.strong(edge)) continue;
      const name = excluded.size === 0 ? undefined : graph.edgeName(edge);
      if (name !== undefined && excluded.has(name)) {
        excludedEdges += 1;
        continue;
      }
      const next = graph.target(edge);
      if (excludedNodes.has(next)) {
        excludedEdges += 1;
        continue;
      }
      if (parent[next] !== -1) continue;
      parent[next] = node;
      via[next] = edge;
      queue[length++] = next;
    }
  }
  return { parent, via, counts, reachable: length, excludedEdges };
}

type PathLinks = { readonly parent: Int32Array; readonly via: Int32Array };

function tracePath(graph: Graph, walk: PathLinks, index: number, labels: ReadonlySet<string>) {
  const path: RetainerStep[] = [];
  let at = index;
  let complete = false;
  while (path.length < 48) {
    const edge = walk.via[at]!;
    const name = edge === -1 ? undefined : graph.edgeName(edge);
    const kind = edge === -1 ? null : graph.kind(edge);
    path.push({
      node: graph.describe(at),
      edgeType: kind === null || edgeKinds.has(kind) ? kind : '[edge]',
      edgeName: name !== undefined && labels.has(name) ? name : null,
    });
    if (at === 0) {
      complete = true;
      break;
    }
    at = walk.parent[at]!;
  }
  return { truncated: !complete, path: path.reverse() };
}

function makePath(
  graph: Graph,
  walk: PathLinks,
  dominance: ReturnType<typeof dominators>,
  index: number,
  labels: ReadonlySet<string>,
): RetainerPath {
  const trace = tracePath(graph, walk, index, labels);
  const chain: RetainerPath['dominators'][number][] = [];
  let parent = dominance.idom[graph.order[index]!]!;
  while (parent !== 0 && chain.length < 32) {
    const node = graph.vertex[parent]!;
    chain.push({ node: graph.describe(node), selfBytes: graph.size(node), retainedBytes: dominance.retained[parent]! });
    parent = dominance.idom[parent]!;
  }
  return {
    selfBytes: graph.size(index),
    retainedBytes: dominance.retained[graph.order[index]!]!,
    truncated: trace.truncated,
    dominatorsTruncated: parent !== 0,
    dominators: chain,
    path: trace.path,
  };
}

function hiddenReferences(
  graph: Graph,
  all: ReturnType<typeof allPaths>,
  limit: number,
  labels: ReadonlySet<string>,
  operations: readonly string[],
): HiddenReferences {
  const marked = new Uint8Array(graph.count);
  const mapTargets: MapTargets = new Map();
  const mapMembership = new Uint32Array(graph.count);
  const targets = { count: 0, selfBytes: 0 };
  const largest: {
    node: RetainerNode;
    selfBytes: number;
    incomingCount: number;
    incoming: HiddenReferences['largest'][number]['incoming'][number][];
  }[] = [];
  for (let index = 0; index < graph.count; index += 1) {
    if (graph.order[index] !== 0) continue;
    const node = graph.describe(index);
    if (node.type !== 'hidden') continue;
    marked[index] = 1;
    const bytes = graph.size(index);
    targets.count += 1;
    targets.selfBytes += bytes;
    if (largest.length < 10 || bytes > largest[largest.length - 1]!.selfBytes) {
      largest.push({ node, selfBytes: bytes, incomingCount: 0, incoming: [] });
      largest.sort((a, b) => b.selfBytes - a.selfBytes || a.node.index - b.node.index);
      if (largest.length > 10) largest.pop();
    }
  }
  const samples = new Map(largest.map((row) => [row.node.index, row]));
  const memberships = new Uint32Array(graph.count);
  const groups = new Map<
    string,
    { sourceType: string; sourceName: string; edgeType: string; count: number; selfBytes: number; seen: Set<number> }
  >();
  for (let source = 0; source < graph.count; source += 1) {
    let node: RetainerNode | undefined;
    for (let edge = graph.offsets[source]!; edge < graph.offsets[source + 1]!; edge += 1) {
      const target = graph.target(edge);
      if (marked[target] === 0) continue;
      node ??= graph.describe(source);
      const kind = graph.kind(edge);
      const edgeType = edgeKinds.has(kind) ? kind : '[edge]';
      if (node.type === 'object' && node.name === 'Map' && graph.order[source] === 0 && kind === 'internal') {
        let map = mapTargets.get(source);
        if (map === undefined) {
          map = { hiddenSelfBytes: 0, targets: new Set() };
          mapTargets.set(source, map);
        }
        if (!map.targets.has(target)) {
          map.targets.add(target);
          map.hiddenSelfBytes += graph.size(target);
          mapMembership[target] = mapMembership[target]! + 1;
        }
      }
      const key = JSON.stringify([node.type, node.name, edgeType]);
      let group = groups.get(key);
      if (group === undefined) {
        group = { sourceType: node.type, sourceName: node.name, edgeType, count: 0, selfBytes: 0, seen: new Set() };
        groups.set(key, group);
      }
      if (!group.seen.has(target)) {
        group.seen.add(target);
        group.count += 1;
        group.selfBytes += graph.size(target);
        memberships[target] = memberships[target]! + 1;
      }
      const sample = samples.get(target);
      if (sample !== undefined) {
        sample.incomingCount += 1;
        if (sample.incoming.length < 8) {
          const name = graph.edgeName(edge);
          sample.incoming.push({ source: node, edgeType, edgeName: name !== undefined && labels.has(name) ? name : null });
        }
      }
    }
  }
  const withIncoming = { count: 0, selfBytes: 0 };
  const withoutIncoming = { count: 0, selfBytes: 0 };
  const multipleGroups = { count: 0, selfBytes: 0 };
  for (let index = 0; index < graph.count; index += 1) {
    if (marked[index] === 0) continue;
    const membership = memberships[index]!;
    const bytes = graph.size(index);
    const covered = membership === 0 ? withoutIncoming : withIncoming;
    covered.count += 1;
    covered.selfBytes += bytes;
    if (membership > 1) {
      multipleGroups.count += 1;
      multipleGroups.selfBytes += bytes;
    }
  }
  const ranked = [...groups.values()].sort((a, b) => b.selfBytes - a.selfBytes || b.count - a.count).slice(0, limit);
  return {
    nonAdditiveGroups: true,
    mapReferrers: mapReferences(graph, all, mapTargets, mapMembership, limit, labels, operations),
    targets,
    withIncoming,
    withoutIncoming,
    multipleGroups,
    groupCount: groups.size,
    groups: ranked.map(({ seen: _seen, ...row }) => row),
    largest,
  };
}

async function readGraph(file: string): Promise<Graph> {
  return graphOf(JSON.parse(await Bun.file(file).text()) as Snapshot);
}

async function readCensus(file: string, limit: number, labels: ReadonlySet<string>, operations: readonly string[]) {
  const graph = await readGraph(file);
  const all = allPaths(graph);
  return {
    census: census(graph, all),
    syntheticSeeds: all.syntheticSeeds,
    outsideHidden: hiddenReferences(graph, all, limit, labels, operations),
  };
}

async function compare(request: Extract<RetainerRequest, { mode: 'compare' }>): Promise<RetainerComparison> {
  const labels = new Set([...defaultLabels, ...request.labels]);
  const previous = await readCensus(request.before, request.limit, labels, request.operations);
  const before = previous.census;
  Bun.gc(true);
  const graph = await readGraph(request.after);
  if (request.excludeNodes.some((index) => index >= graph.count)) throw new Error('excluded node outside snapshot');
  const all = allPaths(graph);
  const after = census(graph, all);
  const outsideHidden = hiddenReferences(graph, all, request.limit, labels, request.operations);
  const walk = pathWalk(graph, new Set(request.excludeLabels), new Set(request.excludeNodes));
  const keys = new Set([...before.classes.keys(), ...after.classes.keys()]);
  const rows = [...keys].map((key) => {
    const previous = before.classes.get(key);
    const current = after.classes.get(key);
    const from: RetainerCount = previous?.stats ?? emptyCount();
    const to: RetainerCount = current?.stats ?? emptyCount();
    return {
      key,
      type: (current ?? previous)!.type,
      name: (current ?? previous)!.name,
      before: from,
      after: to,
      countDelta: to.count - from.count,
      selfBytesDelta: to.selfBytes - from.selfBytes,
      pathCount: walk.counts.get(key) ?? 0,
      examples: [] as RetainerPath[],
      weakExamples: [] as WeakPath[],
    };
  });
  const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const tie = (a: (typeof rows)[number], b: (typeof rows)[number]) => compareText(a.type, b.type) || compareText(a.name, b.name);
  const bySize = rows
    .filter((row) => row.selfBytesDelta > 0)
    .sort((a, b) => b.selfBytesDelta - a.selfBytesDelta || tie(a, b))
    .slice(0, request.limit);
  const byCount = rows
    .filter((row) => row.countDelta > 0)
    .sort((a, b) => b.countDelta - a.countDelta || tie(a, b))
    .slice(0, request.limit);
  const decreasedBySize = rows
    .filter((row) => row.selfBytesDelta < 0)
    .sort((a, b) => a.selfBytesDelta - b.selfBytesDelta || tie(a, b))
    .slice(0, request.limit);
  const decreasedByCount = rows
    .filter((row) => row.countDelta < 0)
    .sort((a, b) => a.countDelta - b.countDelta || tie(a, b))
    .slice(0, request.limit);
  const selected = new Map([...bySize, ...byCount].map((row) => [row.key, row]));
  const dominance = dominators(graph);
  const { retained } = dominance;
  const candidates = new Map<string, number[]>();
  for (let i = 2; i <= graph.found; i += 1) {
    const index = graph.vertex[i]!;
    if (walk.parent[index] === -1) continue;
    const key = classKey(graph.describe(index));
    if (!selected.has(key)) continue;
    const best = candidates.get(key);
    if (best === undefined) {
      candidates.set(key, [i]);
      continue;
    }
    const precedes = (other: number) =>
      retained[i]! > retained[other]! || (retained[i] === retained[other] && index < graph.vertex[other]!);
    if (precedes(best[0]!)) {
      best[1] = best[0]!;
      best[0] = i;
    } else if (best.length === 1 || precedes(best[1]!)) best[1] = i;
  }
  for (const [key, nodes] of candidates) {
    selected.get(key)!.examples = nodes.map((node) => makePath(graph, walk, dominance, graph.vertex[node]!, labels));
  }
  const weakCandidates = new Map<string, number[]>();
  for (let index = 0; index < graph.count; index += 1) {
    if (graph.order[index] !== 0 || all.parent[index] === -1) continue;
    const key = classKey(graph.describe(index));
    if (!selected.has(key)) continue;
    const best = weakCandidates.get(key);
    if (best === undefined) {
      weakCandidates.set(key, [index]);
      continue;
    }
    const precedes = (other: number) => graph.size(index) > graph.size(other) || (graph.size(index) === graph.size(other) && index < other);
    if (precedes(best[0]!)) {
      best[1] = best[0]!;
      best[0] = index;
    } else if (best.length === 1 || precedes(best[1]!)) best[1] = index;
  }
  for (const [key, nodes] of weakCandidates) {
    selected.get(key)!.weakExamples = nodes.map((index) => ({ selfBytes: graph.size(index), ...tracePath(graph, all, index, labels) }));
  }
  const project = (list: typeof rows): RetainerClass[] => list.map(({ key: _key, ...row }) => row);
  return {
    nonAdditiveRetainedBytes: true,
    dominatorsOn: 'unfiltered-strong-graph',
    weakEdgesProveRetention: false,
    weakPathsOn: 'unfiltered-graph',
    syntheticNodesProveRoots: false,
    otherSyntheticSeeds: { before: previous.syntheticSeeds, after: all.syntheticSeeds },
    outsideHidden: { before: previous.outsideHidden, after: outsideHidden },
    before: before.total,
    after: after.total,
    pathWalk: {
      reachable: walk.reachable,
      excludedEdges: walk.excludedEdges,
      excludedLabels: request.excludeLabels,
      excludedNodes: request.excludeNodes,
    },
    bySize: project(bySize),
    byCount: project(byCount),
    decreasedBySize: project(decreasedBySize),
    decreasedByCount: project(decreasedByCount),
  };
}

try {
  const request = workerData as RetainerRequest;
  const summary = request.mode === 'single' ? summarize(await readGraph(request.file), request.limit) : await compare(request);
  parentPort?.postMessage({ ok: true, summary });
} catch {
  parentPort?.postMessage({ ok: false });
}
