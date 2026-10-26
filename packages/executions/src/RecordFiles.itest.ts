import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { RecordFiles } from './RecordFiles';
import { ExecutionRef } from './protocol/execution';
import { byteOffset, type ByteCursor } from './protocol/record';
import {
  CRC32_INITIAL,
  SEAL_FILE,
  SEGMENT_HEADER_BYTES,
  crc32Final,
  crc32Update,
  encodeSegmentHeader,
  recordFolder,
  segmentFile,
} from './recordFormat';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const ref = (execution: string) => Schema.decodeUnknownEffect(ExecutionRef)({ installation: 'files-test', execution, incarnation: 1 });

const cursor = (execution: ExecutionRef, offset: bigint): ByteCursor => ({ ref: execution, stream: 'pty', offset: byteOffset(offset) });

const payload = new TextEncoder().encode('sixteen bytes ok');

const written = Effect.fnUntraced(function* (execution: ExecutionRef) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const records = path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'record-files-' }), 'records');
  const folder = recordFolder(execution.execution);
  if (typeof folder !== 'string') return yield* folder;
  const directory = path.join(records, folder);
  const file = path.join(directory, 'pty', segmentFile(0n));
  yield* fs.makeDirectory(path.join(directory, 'pty'), { recursive: true, mode: 0o700 });
  const header = encodeSegmentHeader('pty', 0n);
  if ('defect' in header) return yield* Effect.die(header.detail);
  const segment = new Uint8Array(header.length + payload.length);
  segment.set(header, 0);
  segment.set(payload, header.length);
  yield* fs.writeFile(file, segment, { mode: 0o600 });
  const seal = {
    ref: { installation: execution.installation, execution: execution.execution, incarnation: execution.incarnation },
    transport: 'pty',
    streams: [
      {
        positions: { stream: 'pty', retainedFrom: '0', durableThrough: String(payload.length), parsedThrough: '0', ending: 'eof' },
        tail: 'complete',
        segments: [{ first: '0', end: String(payload.length), checksum: crc32Final(crc32Update(CRC32_INITIAL, payload)) }],
        grid: [{ at: '0', geometry: { rows: 24, columns: 80 } }],
      },
    ],
  };
  yield* fs.writeFileString(path.join(directory, SEAL_FILE), JSON.stringify(seal), { mode: 0o600 });
  return { records, directory, file };
});

layer(RecordFiles.layer.pipe(Layer.provideMerge(platform)), { excludeTestServices: true })('RecordFiles', (it) => {
  it.effect('a sealed record answers its bytes, and a directory nobody sealed refuses', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const files = yield* RecordFiles;
      const execution = yield* ref('sealed');
      const { records, directory } = yield* written(execution);
      const record = yield* files.open(records, execution);
      const read = yield* record.read(cursor(execution, 0n), payload.length);
      yield* fs.remove(`${directory}/${SEAL_FILE}`);
      const unsealed = yield* Effect.flip(files.open(records, execution));
      expect(read.bytes).toEqual(payload);
      expect(read.range.durableThrough).toBe(byteOffset(BigInt(payload.length)));
      expect(read.range.gap).toBe(false);
      expect(unsealed._tag).toBe('RecordSealMissing');
    }),
  );

  it.effect('a malformed seal or a seal of another execution is refused whole', () =>
    Effect.gen(function* () {
      const files = yield* RecordFiles;
      const execution = yield* ref('incompatible');
      const fs = yield* FileSystem.FileSystem;
      const { records, directory } = yield* written(execution);
      yield* fs.writeFileString(`${directory}/${SEAL_FILE}`, '{}');
      const incompatible = yield* Effect.flip(files.open(records, execution));
      const stale = yield* ref('stale');
      const written1 = yield* written(stale);
      const seal = yield* fs.readFileString(`${written1.directory}/${SEAL_FILE}`);
      yield* fs.writeFileString(`${written1.directory}/${SEAL_FILE}`, seal.replace('"incarnation":1', '"incarnation":2'));
      const mismatch = yield* Effect.flip(files.open(written1.records, stale));

      const own = yield* ref('own');
      const record = yield* files.open((yield* written(own)).records, own);
      const foreign = yield* Effect.flip(record.read(cursor(stale, 0n), 4));
      expect(incompatible._tag).toBe('RecordUnreadable');
      if (incompatible._tag !== 'RecordUnreadable') return;
      expect(incompatible.reason).toBe('incompatible');
      expect(mismatch._tag).toBe('RecordInvalid');
      if (mismatch._tag !== 'RecordInvalid') return;
      expect(mismatch.named.incarnation).toBe(2);
      expect(foreign._tag).toBe('RecordCursorRefused');
      if (foreign._tag !== 'RecordCursorRefused') return;
      expect(foreign.reason).toBe('ref');
    }),
  );

  it.effect('an identifier that cannot name one directory of its own is refused, never encoded', () =>
    Effect.gen(function* () {
      const lone = recordFolder('\ud800' as ExecutionRef['execution']);
      const paired = recordFolder('\ud800\udc00' as ExecutionRef['execution']);
      const empty = recordFolder('' as ExecutionRef['execution']);
      const long = recordFolder('e'.repeat(128) as ExecutionRef['execution']);
      const files = yield* RecordFiles;
      const fs = yield* FileSystem.FileSystem;
      const records = yield* fs.makeTempDirectoryScoped({ prefix: 'record-names-' });
      const refused = yield* Effect.flip(files.open(records, { ...(yield* ref('x')), execution: '\ud800' as ExecutionRef['execution'] }));
      expect(typeof lone === 'string' ? 'encoded' : lone.reason).toBe('unpaired-surrogate');
      expect(typeof empty === 'string' ? 'encoded' : empty.reason).toBe('empty');
      expect(typeof long === 'string' ? 'encoded' : long.reason).toBe('too-long');
      expect(paired).toBe('f0908080');
      expect(refused._tag).toBe('RecordNameInvalid');
    }),
  );

  it.effect('a seal that contradicts itself is refused whole, before any of it is believed', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const files = yield* RecordFiles;
      const execution = yield* ref('overlap');
      const { records, directory } = yield* written(execution);
      const seal = yield* fs.readFileString(`${directory}/${SEAL_FILE}`);
      const overlapping = seal.replace(
        `"segments":[{"first":"0","end":"${payload.length}"`,
        `"segments":[{"first":"0","end":"${payload.length}","checksum":0},{"first":"0","end":"${payload.length}"`,
      );
      yield* fs.writeFileString(`${directory}/${SEAL_FILE}`, overlapping);
      const outcome = yield* Effect.flip(files.open(records, execution));
      expect(outcome._tag === 'RecordUnreadable' ? outcome.reason : outcome._tag).toBe('incompatible');
    }),
  );

  it.effect('a terminal seal of this format whose grid does not stand at its oldest byte is refused whole', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const files = yield* RecordFiles;
      const refusals: string[] = [];
      for (const grid of [
        '[]',
        '[{"at":"4","geometry":{"rows":24,"columns":80}}]',
        '[{"at":"0","geometry":{"rows":24,"columns":80}},{"at":"0","geometry":{"rows":30,"columns":100}}]',
      ]) {
        const execution = yield* ref(`track-${refusals.length}`);
        const { records, directory } = yield* written(execution);
        const seal = yield* fs.readFileString(`${directory}/${SEAL_FILE}`);
        yield* fs.writeFileString(`${directory}/${SEAL_FILE}`, seal.replace(/"grid":\[.*?\]\}\]/, `"grid":${grid}}]`));
        const refusal = yield* Effect.flip(files.open(records, execution));
        refusals.push(refusal._tag === 'RecordUnreadable' ? refusal.reason : refusal._tag);
      }
      expect(refusals).toEqual(['incompatible', 'incompatible', 'incompatible']);
    }),
  );

  it.effect('a segment cut short, damaged in its payload or in its identity is never served', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const files = yield* RecordFiles;
      const execution = yield* ref('damaged');

      const cut = yield* written(execution);
      yield* fs.truncate(cut.file, 24);
      const short = yield* Effect.flip(
        yield* Effect.map(files.open(cut.records, execution), (record) => record.read(cursor(execution, 0n), 16)),
      );

      const flipped = yield* written(execution);
      const bytes = yield* fs.readFile(flipped.file);
      bytes[24] = (bytes[24] ?? 0) ^ 0xff;
      yield* fs.writeFile(flipped.file, bytes);
      const damaged = yield* Effect.flip(
        yield* Effect.map(files.open(flipped.records, execution), (record) => record.read(cursor(execution, 0n), 16)),
      );

      const renamed = yield* written(execution);
      const identity = yield* fs.readFile(renamed.file);
      identity[0] = (identity[0] ?? 0) ^ 0xff;
      yield* fs.writeFile(renamed.file, identity);
      const foreign = yield* Effect.flip(
        yield* Effect.map(files.open(renamed.records, execution), (record) => record.read(cursor(execution, 0n), 16)),
      );

      for (const refusal of [short, damaged, foreign]) expect(refusal._tag).toBe('RecordUnreadable');
      if (short._tag !== 'RecordUnreadable' || damaged._tag !== 'RecordUnreadable' || foreign._tag !== 'RecordUnreadable') return;
      expect(short.reason).toBe('short');
      expect(damaged.reason).toBe('checksum');
      expect(foreign.reason).toBe('magic');
    }),
  );
});
