import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { HeapUnreadable, readHeap, reportHeap } from '@runlith/performance/HeapReader';
import * as Effect from 'effect/Effect';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';

const types = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic'];
const fields = ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id', 'detachedness'];

function snapshot(nodes: readonly number[], strings: readonly string[], layout: readonly string[] = fields): string {
  return JSON.stringify({
    snapshot: {
      meta: { node_fields: layout, node_types: layout.map((field) => (field === 'type' ? types : field === 'name' ? 'string' : 'number')) },
      node_count: nodes.length / layout.length,
      edge_count: 0,
    },
    nodes,
    edges: [],
    trace_function_infos: [],
    trace_tree: [],
    samples: [],
    locations: [],
    strings,
  });
}

it.live('summarizes V8 classes by metadata offsets without exposing heap string or regexp contents', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-heap-reader-');
    const file = join(directory, 'page.heapsnapshot');
    const secret = 'private-heap-value';
    const className = 'Widgetα🧩';
    const strings = ['', className, secret.repeat(6000), className, 'HTMLDivElement', secret, 'Function'];
    writeFileSync(
      file,
      snapshot(
        [
          9, 0, 1, 0, 0, 0, 0, 3, 1, 3, 24, 0, 0, 0, 3, 3, 5, 32, 0, 0, 2, 2, 2, 7, 72, 0, 0, 0, 8, 4, 8, 48, 0, 0, 2, 8, 4, 10, 48, 0, 0,
          1, 6, 5, 11, 40, 0, 0, 0, 5, 1, 13, 16, 0, 0, 0, 4, 1, 15, 8, 0, 0, 0,
        ],
        strings,
      ),
    );
    expect(yield* readHeap(file)).toEqual({
      sizeBytes: 288,
      objectCount: 9,
      detachedNodes: 1,
      classes: [
        { name: 'HTMLDivElement', count: 2, sizeBytes: 96 },
        { name: '(string)', count: 1, sizeBytes: 72 },
        { name: className, count: 2, sizeBytes: 56 },
        { name: '(regexp)', count: 1, sizeBytes: 40 },
        { name: '(closure)', count: 1, sizeBytes: 16 },
        { name: '(code)', count: 1, sizeBytes: 8 },
        { name: '(synthetic)', count: 1, sizeBytes: 0 },
      ],
    });

    const compact = ['self_size', 'detachedness', 'id', 'name', 'edge_count', 'type'];
    writeFileSync(file, snapshot([16, 2, 2, 1, 0, 8, 24, 0, 3, 2, 0, 3], ['', 'HTMLSpanElement', 'Escaped"\\\nΩ'], compact));
    expect(yield* readHeap(file)).toEqual({
      sizeBytes: 40,
      objectCount: 2,
      detachedNodes: 1,
      classes: [
        { name: 'Escaped"\\\nΩ', count: 1, sizeBytes: 24 },
        { name: 'HTMLSpanElement', count: 1, sizeBytes: 16 },
      ],
    });
  }),
);

it.live('refuses unreadable, malformed and incomplete snapshots without returning source contents', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-heap-invalid-');
    const file = join(directory, 'page.heapsnapshot');
    const valid = snapshot([3, 1, 1, 24, 0, 0, 0], ['', 'Widget']);
    const secret = 'private-heap-value';
    const malformed = [
      valid.slice(0, -2) + secret,
      valid.replace('"node_count":1', '"node_count":2'),
      snapshot([3, 9, 1, 24, 0, 0, 0], ['', 'Widget']),
      valid.replace('[3,1,1,24,0,0,0]', '[3,1,1,024,0,0,0]'),
      valid.replace('"node_fields":["type"', '"node_fields":["missing"'),
      valid.replace('"Widget"', '"\\u00zz' + secret + '"'),
    ];
    for (const contents of malformed) {
      writeFileSync(file, contents);
      const result = yield* Effect.result(readHeap(file));
      expect(result._tag).toBe('Failure');
      if (result._tag !== 'Failure') continue;
      expect(result.failure).toBeInstanceOf(HeapUnreadable);
      expect(JSON.stringify(result.failure)).not.toContain(secret);
    }
    const missing = yield* Effect.result(readHeap(join(directory, 'missing.heapsnapshot')));
    expect(missing._tag).toBe('Failure');
    if (missing._tag === 'Failure') expect(missing.failure).toBeInstanceOf(HeapUnreadable);
  }),
);

it.live('keeps the full class baseline in the worker while limiting self-size and positive-growth rows', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-heap-growth-');
    const file = join(directory, 'page.heapsnapshot');
    const previous = join(directory, 'previous.json');
    const sidecar = join(directory, 'current.json');
    const strings = ['', 'Stable', 'Falling', 'HeapCanary', 'New'];
    writeFileSync(
      file,
      snapshot([3, 1, 1, 100, 0, 0, 0, 3, 2, 3, 40, 0, 0, 0, 3, 2, 5, 40, 0, 0, 0, 3, 3, 7, 10, 0, 0, 0, 3, 3, 9, 10, 0, 0, 0], strings),
    );
    expect(yield* reportHeap(file, { sidecar: previous, limit: 2 })).toEqual({
      sizeBytes: 200,
      objectCount: 5,
      detachedNodes: 0,
      classCount: 3,
      classes: [
        { name: 'Stable', count: 1, sizeBytes: 100, countDelta: null, sizeDelta: null },
        { name: 'Falling', count: 2, sizeBytes: 80, countDelta: null, sizeDelta: null },
      ],
      growth: [],
    });
    writeFileSync(
      file,
      snapshot(
        [
          3, 1, 1, 100, 0, 0, 0, 3, 2, 3, 40, 0, 0, 0, 3, 3, 7, 10, 0, 0, 0, 3, 3, 9, 10, 0, 0, 0, 3, 3, 11, 10, 0, 0, 0, 3, 4, 13, 5, 0, 0,
          0,
        ],
        strings,
      ),
    );
    expect(yield* reportHeap(file, { previous, sidecar, limit: 2 })).toEqual({
      sizeBytes: 175,
      objectCount: 6,
      detachedNodes: 0,
      classCount: 4,
      classes: [
        { name: 'Stable', count: 1, sizeBytes: 100, countDelta: 0, sizeDelta: 0 },
        { name: 'Falling', count: 1, sizeBytes: 40, countDelta: -1, sizeDelta: -40 },
      ],
      growth: [
        { name: 'HeapCanary', count: 3, sizeBytes: 30, countDelta: 1, sizeDelta: 10 },
        { name: 'New', count: 1, sizeBytes: 5, countDelta: 1, sizeDelta: 5 },
      ],
    });
    const secret = 'private-baseline-value';
    writeFileSync(previous, JSON.stringify({ classes: secret }));
    const invalid = yield* Effect.result(reportHeap(file, { previous, sidecar, limit: 2 }));
    expect(invalid._tag).toBe('Failure');
    if (invalid._tag === 'Failure') {
      expect(invalid.failure).toBeInstanceOf(HeapUnreadable);
      expect(JSON.stringify(invalid.failure)).not.toContain(secret);
    }
    const destination = join(directory, 'destination');
    mkdirSync(destination);
    const unwritable = yield* Effect.result(reportHeap(file, { sidecar: destination, limit: 2 }));
    expect(unwritable._tag).toBe('Failure');
    if (unwritable._tag === 'Failure') expect(unwritable.failure).toBeInstanceOf(HeapUnreadable);
    expect(existsSync(`${destination}.partial`)).toBe(false);
  }),
);
