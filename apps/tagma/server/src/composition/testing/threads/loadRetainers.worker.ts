import { parentPort, workerData } from 'node:worker_threads';
import type { RetainerNode, RetainerRow, RetainerSummary } from './loadRetainers.js';

type Snapshot = {
  snapshot: {
    meta: { node_fields: string[]; node_types: (string | string[])[]; edge_fields: string[]; edge_types: (string | string[])[] };
  };
  nodes: number[];
  edges: number[];
  strings: string[];
};

function summarize(snapshot: Snapshot, limit: number): RetainerSummary {
  const meta = snapshot.snapshot.meta;
  const nf = meta.node_fields;
  const ef = meta.edge_fields;
  const typeAt = nf.indexOf('type');
  const nameAt = nf.indexOf('name');
  const sizeAt = nf.indexOf('self_size');
  const countAt = nf.indexOf('edge_count');
  const edgeTypeAt = ef.indexOf('type');
  const targetAt = ef.indexOf('to_node');
  const nodeTypes = meta.node_types[typeAt];
  const edgeTypes = meta.edge_types[edgeTypeAt];
  if ([typeAt, nameAt, sizeAt, countAt, edgeTypeAt, targetAt].some((i) => i < 0) || !Array.isArray(nodeTypes) || !Array.isArray(edgeTypes))
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
  for (let i = 1; i <= found; i += 1) {
    const size = nodes[vertex[i]! * nf.length + sizeAt]!;
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid size');
    retained[i] = size;
  }
  for (let i = found; i >= 2; i -= 1) {
    const parent = idom[i]!;
    retained[parent] = retained[parent]! + retained[i]!;
  }
  const describe = (i: number): RetainerNode => {
    const index = vertex[i]!;
    const type = nodeTypes[nodes[index * nf.length + typeAt]!] ?? 'unknown';
    const name = type === 'object' || type === 'native' ? (snapshot.strings[nodes[index * nf.length + nameAt]!] ?? '') : `[${type}]`;
    return { index, type, name };
  };
  const candidates: number[] = [];
  for (let i = 2; i <= found; i += 1) candidates.push(i);
  candidates.sort((a, b) => retained[b]! - retained[a]! || vertex[a]! - vertex[b]!);
  const rows: RetainerRow[] = candidates.slice(0, limit).map((i) => {
    const dominators: RetainerNode[] = [];
    for (let p = idom[i]!; p !== 0; p = idom[p]!) dominators.push(describe(p));
    return { ...describe(i), selfBytes: nodes[vertex[i]! * nf.length + sizeAt]!, retainedBytes: retained[i]!, dominators };
  });
  return { nonAdditive: true, reachable: found, rows };
}

try {
  const { file, limit } = workerData as { file: string; limit: number };
  const snapshot = JSON.parse(await Bun.file(file).text()) as Snapshot;
  parentPort?.postMessage({ ok: true, summary: summarize(snapshot, limit) });
} catch {
  parentPort?.postMessage({ ok: false });
}
