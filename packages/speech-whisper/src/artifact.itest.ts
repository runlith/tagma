import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import { ArtifactCache, CacheInvalid } from './artifact.js';

const root = realpathSync(mkdtempSync('/tmp/whisper-artifact-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const artifact = { engine: new Uint8Array([1, 2, 3]), silero: new Uint8Array([4, 5]) };

test('a cached pair belongs to its inputs and is replaced as one artifact', () => {
  const cache = new ArtifactCache(join(root, 'current'));
  expect(cache.read('first')).toBeNull();
  cache.write('first', artifact);
  expect(cache.read('first')).toEqual(artifact);
  expect(cache.read('other')).toBeNull();
  const next = { engine: new Uint8Array([9]), silero: new Uint8Array([8, 7, 6]) };
  cache.write('next', next);
  expect(cache.read('next')).toEqual(next);
  expect(cache.read('first')).toBeNull();
});

test('a truncated artifact refuses instead of yielding a partial pair', () => {
  const path = join(root, 'truncated');
  const cache = new ArtifactCache(path);
  cache.write('input', artifact);
  const bytes = readFileSync(path);
  writeFileSync(path, bytes.subarray(0, bytes.length - 1));
  expect(() => cache.read('input')).toThrow(CacheInvalid);
});

test('changed artifact bytes refuse even when their lengths still agree', () => {
  const path = join(root, 'changed');
  const cache = new ArtifactCache(path);
  cache.write('input', artifact);
  const bytes = readFileSync(path);
  bytes.writeUInt8(bytes.readUInt8(bytes.length - 1) ^ 1, bytes.length - 1);
  writeFileSync(path, bytes);
  expect(() => cache.read('input')).toThrow(CacheInvalid);
});
