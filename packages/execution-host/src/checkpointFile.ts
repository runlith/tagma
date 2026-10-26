import { Data, Effect, FileSystem, Path, type PlatformError, Schema } from 'effect';
import { ByteOffset, TerminalGeometry, offsetValue } from '@runlith/executions/protocol/record';
import { CheckpointUnwritable, INTERPRETATION_REASONS, InterpretationUnavailable, type Interpretation } from './Interpretation';
import type { ScreenCheckpoint } from './ScreenCheckpoint';

export const ABANDONED_FILE = 'screen.abandoned';
export const RETIRED_FILE = 'screen.retired';

const CHECKPOINT_NAME = /^screen-(\d{20})\.checkpoint$/u;

const checkpointFile = (position: ByteOffset): string => `screen-${position.padStart(20, '0')}.checkpoint`;

export class CheckpointUnkept extends Data.TaggedError('CheckpointUnkept')<{
  readonly act: 'encode' | 'write' | 'rename' | 'remove' | 'list';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

const Header = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Checkpoint'),
    position: ByteOffset,
    geometry: TerminalGeometry,
    links: Schema.Array(Schema.Struct({ token: Schema.String, id: Schema.optional(Schema.String), uri: Schema.String })),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Abandoned'),
    reason: Schema.Literals(INTERPRETATION_REASONS),
    parsedThrough: ByteOffset,
    detail: Schema.String,
  }),
]);

const headerCodec = Schema.fromJsonString(Header);
const encodeHeader = Schema.encodeEffect(headerCodec);
const decodeHeader = Schema.decodeUnknownResult(headerCodec);

export type CheckpointStanding =
  | { readonly _tag: 'Checkpoint'; readonly checkpoint: ScreenCheckpoint }
  | { readonly _tag: 'Abandoned'; readonly failure: InterpretationUnavailable }
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Unreadable'; readonly detail: string };

const NEWLINE = 0x0a;

const published = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  name: string,
  header: typeof Header.Type,
  body: ReadonlyArray<Uint8Array>,
): Effect.fn.Return<void, CheckpointUnkept> {
  const encoded = yield* encodeHeader(header).pipe(
    Effect.mapError((error) => new CheckpointUnkept({ act: 'encode', detail: error.message })),
  );
  const target = path.join(directory, name);
  const draft = `${target}.${crypto.randomUUID()}`;
  const unkept = (act: 'write' | 'rename') => (error: PlatformError.PlatformError) =>
    Effect.matchEffect(fs.remove(draft, { force: true }), {
      onFailure: (removed) => new CheckpointUnkept({ act, detail: `${error.message}; the draft ${draft} also stays: ${removed.message}` }),
      onSuccess: () => new CheckpointUnkept({ act, detail: error.message }),
    });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fs.open(draft, { flag: 'wx', mode: 0o600 });
      yield* handle.writeAll(new TextEncoder().encode(`${encoded}\n`));
      for (const piece of body) yield* handle.writeAll(piece);
    }),
  ).pipe(Effect.catchTag('PlatformError', unkept('write')));
  yield* fs.rename(draft, target).pipe(Effect.catchTag('PlatformError', unkept('rename')));
});

const listed = (fs: FileSystem.FileSystem, directory: string): Effect.Effect<ReadonlyArray<string>, CheckpointUnkept> =>
  fs.readDirectory(directory).pipe(Effect.mapError((error) => new CheckpointUnkept({ act: 'list', detail: error.message })));

const removed = (fs: FileSystem.FileSystem, path: Path.Path, directory: string, name: string): Effect.Effect<void, CheckpointUnkept> =>
  fs
    .remove(path.join(directory, name), { force: true })
    .pipe(Effect.mapError((error) => new CheckpointUnkept({ act: 'remove', detail: error.message })));

const positionOf = (name: string): bigint | undefined => {
  const matched = CHECKPOINT_NAME.exec(name);
  return matched === null ? undefined : BigInt(matched[1] as string);
};

export const keepCheckpoint = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  checkpoint: ScreenCheckpoint,
): Effect.fn.Return<void, CheckpointUnkept> {
  const name = checkpointFile(checkpoint.position);
  const header = { _tag: 'Checkpoint', position: checkpoint.position, geometry: checkpoint.geometry, links: checkpoint.links } as const;
  yield* published(fs, path, directory, name, header, checkpoint.bytes);
  const names = yield* listed(fs, directory);
  const position = offsetValue(checkpoint.position);
  for (const entry of names) {
    const older = positionOf(entry);
    if (entry === RETIRED_FILE || (older !== undefined && older < position))
      yield* removed(fs, path, directory, entry === RETIRED_FILE ? name : entry);
  }
});

export const keepTaken = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  taken: ScreenCheckpoint | CheckpointUnwritable,
): Effect.Effect<void> =>
  taken instanceof CheckpointUnwritable
    ? Effect.logWarning('the screen checkpoint could not be composed, so the previous one stands', taken)
    : keepCheckpoint(fs, path, directory, taken).pipe(
        Effect.catchTag('CheckpointUnkept', (failure) =>
          Effect.logWarning('the screen checkpoint could not be kept, so the previous one stands', failure),
        ),
      );

export const abandonCheckpoint = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  failure: InterpretationUnavailable,
): Effect.Effect<void, CheckpointUnkept> =>
  published(
    fs,
    path,
    directory,
    ABANDONED_FILE,
    { _tag: 'Abandoned', reason: failure.reason, parsedThrough: failure.parsedThrough, detail: failure.detail },
    [],
  );

export const retireCheckpoint = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
): Effect.fn.Return<void, CheckpointUnkept> {
  yield* fs
    .writeFile(path.join(directory, RETIRED_FILE), new Uint8Array(0), { mode: 0o600 })
    .pipe(Effect.mapError((error) => new CheckpointUnkept({ act: 'write', detail: error.message })));
  for (const entry of yield* listed(fs, directory)) {
    if (positionOf(entry) !== undefined || entry === ABANDONED_FILE) yield* removed(fs, path, directory, entry);
  }
});

const decoded = (bytes: Uint8Array): { readonly header: typeof Header.Type; readonly body: Uint8Array } | string => {
  const end = bytes.indexOf(NEWLINE);
  if (end < 0) return 'the checkpoint file carries no header line';
  const header = decodeHeader(new TextDecoder().decode(bytes.subarray(0, end)));
  if (header._tag === 'Failure') return header.failure.message;
  return { header: header.success, body: bytes.subarray(end + 1) };
};

const standingOf = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  names: ReadonlyArray<string>,
): Effect.fn.Return<CheckpointStanding | undefined> {
  if (names.includes(RETIRED_FILE)) return { _tag: 'Absent' } as const;
  const abandoned = names.includes(ABANDONED_FILE);
  let newest: { readonly name: string; readonly position: bigint } | undefined;
  for (const name of names) {
    const position = positionOf(name);
    if (position !== undefined && (newest === undefined || position > newest.position)) newest = { name, position };
  }
  const chosen = abandoned ? ABANDONED_FILE : newest?.name;
  if (chosen === undefined) return { _tag: 'Absent' } as const;
  return yield* fs.readFile(path.join(directory, chosen)).pipe(
    Effect.map((bytes): CheckpointStanding => {
      const read = decoded(bytes);
      if (typeof read === 'string') return { _tag: 'Unreadable', detail: read };
      const { header, body } = read;
      if (header._tag === 'Abandoned') {
        const { _tag, ...failure } = header;
        return { _tag: 'Abandoned', failure: new InterpretationUnavailable(failure) };
      }
      const links = header.links.map((link) => ({ token: link.token, id: link.id, uri: link.uri }));
      return { _tag: 'Checkpoint', checkpoint: { position: header.position, geometry: header.geometry, links, bytes: [body] } };
    }),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(undefined)),
    Effect.catchTag('PlatformError', (failure) => Effect.succeed<CheckpointStanding>({ _tag: 'Unreadable', detail: failure.message })),
  );
});

export const standingCheckpoint = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
): Effect.fn.Return<CheckpointStanding> {
  for (;;) {
    const standing = yield* fs.readDirectory(directory).pipe(
      Effect.flatMap((names) => standingOf(fs, path, directory, names)),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed<CheckpointStanding>({ _tag: 'Absent' })),
      Effect.catchTag('PlatformError', (failure) => Effect.succeed<CheckpointStanding>({ _tag: 'Unreadable', detail: failure.message })),
    );
    if (standing !== undefined) return standing;
  }
});

export const checkpointScreen = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  interpretation: Interpretation,
): Effect.fn.Return<boolean, InterpretationUnavailable | CheckpointUnwritable | CheckpointUnkept> {
  if ((yield* interpretation.unavailable) !== undefined) return false;
  const taken = yield* interpretation.checkpoint();
  if (taken === undefined) return false;
  yield* keepCheckpoint(fs, path, directory, taken);
  return true;
});
