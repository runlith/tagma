import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Effect from 'effect/Effect';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeapSnapshots, heapSnapshotsLayer } from './HeapSnapshots.js';
import { scratchDirectory } from './testing/scratchDirectory.js';

it.live('a capture writes a readable snapshot, keeps the newest four and removes a partial file', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-heap-snapshots-');
    const earlier = ['1000-a', '2000-b', '3000-c', '4000-d'].map((name) => `${name}.heapsnapshot`);
    const held = Array.from({ length: 200_000 }, (_, index) => ({ index, text: `held ${index}` }));
    for (const name of earlier) writeFileSync(join(directory, name), '{}');
    writeFileSync(join(directory, '5000-e.heapsnapshot.partial'), '{');

    const snapshot = yield* HeapSnapshots.use((heap) => heap.capture({ requestedBy: 'test' })).pipe(
      Effect.provide(heapSnapshotsLayer({ instanceId: 'process', directory })),
    );

    expect(snapshot.kept).toEqual([
      snapshot.file,
      ...['4000-d', '3000-c', '2000-b'].map((name) => join(directory, `${name}.heapsnapshot`)),
    ]);
    expect(readdirSync(directory).sort()).toEqual(snapshot.kept.map((file) => file.slice(directory.length + 1)).sort());
    expect(statSync(snapshot.file).size).toBe(snapshot.bytes);
    const parsed = JSON.parse(readFileSync(snapshot.file, 'utf8')) as { readonly snapshot: { readonly node_count: number } };
    expect(parsed.snapshot.node_count).toBeGreaterThan(held.length);
  }),
);
