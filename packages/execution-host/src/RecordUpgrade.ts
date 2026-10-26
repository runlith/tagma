import { Effect, FileSystem, Path, Schema } from 'effect';
import {
  CRC32_INITIAL,
  JOURNAL_FILE,
  RecordSeal,
  SEAL_FILE,
  SEGMENT_HEADER_BYTES,
  crc32Final,
  crc32Update,
  journalCodec,
  readSegmentHeader,
  sealCodec,
  segmentFile,
  type JournalSnapshot,
} from '@runlith/executions/recordFormat';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { RecordWriteFailed } from './RecordWriter';

const COMPLETE = '.header-layout';
const OUTPUT_COMPLETE = '.output-stream';
const numbered = Schema.fromJsonString(Schema.Struct({ ...RecordSeal.fields, version: Schema.Literals([1, 2]) }));
const decode = Schema.decodeUnknownEffect(numbered);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encode = Schema.encodeEffect(sealCodec);
const decodeEntry = Schema.decodeUnknownEffect(journalCodec);
const encodeEntry = Schema.encodeEffect(journalCodec);

const headerLayout = Effect.fnUntraced(
  function* (records: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fs.exists(records)) || (yield* fs.exists(path.join(records, COMPLETE)))) return;
    for (const folder of yield* fs.readDirectory(records)) {
      const directory = path.join(records, folder);
      if ((yield* fs.stat(directory)).type !== 'Directory') continue;
      const file = path.join(directory, SEAL_FILE);
      if (!(yield* fs.exists(file))) continue;
      const text = yield* fs.readFileString(file);
      const value = yield* decodeJson(text);
      if (value === null || typeof value !== 'object' || !('version' in value)) continue;
      const seal = yield* decode(text);
      for (const stream of seal.streams) {
        for (const segment of stream.segments) {
          const segmentPath = path.join(directory, stream.positions.stream, segmentFile(offsetValue(segment.first)));
          yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* fs.open(segmentPath, { flag: 'r+' });
              const header = new Uint8Array(SEGMENT_HEADER_BYTES);
              let taken = 0;
              while (taken < header.length) {
                const read = yield* handle.read(header.subarray(taken));
                if (read === 0) return yield* new RecordWriteFailed({ act: 'segment', detail: `${segmentPath}: the header is short` });
                taken += read;
              }
              const view = new DataView(header.buffer);
              if (crc32Final(crc32Update(CRC32_INITIAL, header.subarray(0, 16))) !== view.getUint32(16, true)) {
                return yield* new RecordWriteFailed({ act: 'segment', detail: `${segmentPath}: the header checksum differs` });
              }
              const layout = view.getUint16(4, true);
              if (layout !== 0 && layout !== seal.version) {
                return yield* new RecordWriteFailed({
                  act: 'segment',
                  detail: `${segmentPath}: the numbered header differs from its seal`,
                });
              }
              view.setUint16(4, 0, true);
              view.setUint32(16, crc32Final(crc32Update(CRC32_INITIAL, header.subarray(0, 16))), true);
              const declared = readSegmentHeader(header);
              if ('defect' in declared || declared.stream !== stream.positions.stream || declared.first !== offsetValue(segment.first)) {
                return yield* new RecordWriteFailed({
                  act: 'segment',
                  detail: `${segmentPath}: the segment identity differs from its seal`,
                });
              }
              if (layout === 0) return;
              yield* handle.seek(0n, 'start');
              yield* handle.writeAll(header);
              yield* handle.sync;
            }),
          );
        }
      }
      const current: RecordSeal = { ref: seal.ref, transport: seal.transport, streams: seal.streams };
      const draft = `${file}.next`;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* fs.open(draft, { flag: 'w', mode: 0o600 });
          yield* handle.writeAll(new TextEncoder().encode(yield* encode(current)));
          yield* handle.sync;
        }),
      );
      yield* fs.rename(draft, file);
    }
    yield* fs.writeFileString(path.join(records, COMPLETE), 'complete\n', { mode: 0o600 });
  },
  Effect.catchTag('PlatformError', (error) => Effect.fail(new RecordWriteFailed({ act: 'segment', detail: error.message }))),
  Effect.catchTag('SchemaError', (error) => Effect.fail(new RecordWriteFailed({ act: 'seal', detail: error.message }))),
);

const outputStreams = Effect.fnUntraced(
  function* (records: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fs.exists(records)) || (yield* fs.exists(path.join(records, OUTPUT_COMPLETE)))) return;
    for (const folder of yield* fs.readDirectory(records)) {
      const directory = path.join(records, folder);
      if ((yield* fs.stat(directory)).type !== 'Directory') continue;
      const file = path.join(directory, JOURNAL_FILE);
      if ((yield* fs.exists(path.join(directory, SEAL_FILE))) || !(yield* fs.exists(file))) continue;
      const bytes = yield* fs.readFile(file);
      const opening = bytes.indexOf(10);
      if (opening < 0) continue;
      const entry = yield* decodeEntry(new TextDecoder().decode(bytes.subarray(0, opening)));
      if (entry._tag !== 'Snapshot' || entry.state.transport !== 'pipes') continue;
      if (entry.state.streams.some((held) => held.stream === 'output')) continue;
      yield* fs.makeDirectory(path.join(directory, 'output'), { recursive: true, mode: 0o700 });
      const state: JournalSnapshot = {
        ...entry.state,
        streams: [...entry.state.streams, { stream: 'output', retainedFrom: byteOffset(0n), segments: [], ending: 'open', grid: [] }],
      };
      const line = new TextEncoder().encode(`${yield* encodeEntry({ _tag: 'Snapshot', state })}\n`);
      const draft = `${file}.next`;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* fs.open(draft, { flag: 'w', mode: 0o600 });
          yield* handle.writeAll(line);
          yield* handle.writeAll(bytes.subarray(opening + 1));
          yield* handle.sync;
        }),
      );
      yield* fs.rename(draft, file);
    }
    yield* fs.writeFileString(path.join(records, OUTPUT_COMPLETE), 'complete\n', { mode: 0o600 });
  },
  Effect.catchTag('PlatformError', (error) => Effect.fail(new RecordWriteFailed({ act: 'journal', detail: error.message }))),
  Effect.catchTag('SchemaError', (error) => Effect.fail(new RecordWriteFailed({ act: 'journal', detail: error.message }))),
);

export const upgradeRecords = Effect.fnUntraced(function* ({ records }: { readonly records: string }) {
  yield* headerLayout(records);
  yield* outputStreams(records);
});
