import { expect } from 'bun:test';
import { ByteSize, Effect, FileSystem, Option, Scope, Stream } from 'effect';

const sandbox = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'conformance-' });
  return { fs, root: yield* fs.realPath(root) };
});

interface Scenario {
  readonly name: string;
  readonly effect: Effect.Effect<void, unknown, FileSystem.FileSystem | Scope.Scope>;
}

export const scenarios: ReadonlyArray<Scenario> = [
  {
    name: 'directories and bytes survive independent reads, append, truncation and exclusive creation',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      yield* fs.makeDirectory(`${root}/nested/deep`, { recursive: true });
      yield* fs.makeDirectory(`${root}/nested/deep`, { recursive: true });
      const path = `${root}/nested/data`;
      const bytes = new Uint8Array([1, 2, 3]);
      yield* fs.writeFile(path, bytes);
      bytes[0] = 9;
      const read = yield* fs.readFile(path);
      expect([...read]).toEqual([1, 2, 3]);
      read[1] = 9;
      expect([...(yield* fs.readFile(path))]).toEqual([1, 2, 3]);
      yield* fs.writeFile(path, new Uint8Array([4]), { flag: 'a' });
      expect([...(yield* fs.readFile(path))]).toEqual([1, 2, 3, 4]);
      const exclusive = yield* Effect.flip(fs.writeFile(path, new Uint8Array([5]), { flag: 'wx' }));
      expect(exclusive.reason._tag).toBe('AlreadyExists');
      yield* fs.truncate(path, 2);
      yield* fs.truncate(path, 4);
      expect([...(yield* fs.readFile(path))]).toEqual([1, 2, 0, 0]);
      yield* fs.writeFileString(`${root}/nested/utf8`, 'Привет 世界');
      expect(yield* fs.readFileString(`${root}/nested/utf8`)).toBe('Привет 世界');
      expect((yield* fs.readDirectory(`${root}/nested`)).sort()).toEqual(['data', 'deep', 'utf8']);
      expect((yield* fs.readDirectory(root, { recursive: true })).sort()).toEqual(['nested', 'nested/data', 'nested/deep', 'nested/utf8']);
    }),
  },

  {
    name: 'missing paths and wrong entry kinds refuse without creating parents or changing existing bytes',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      const missing = `${root}/missing`;
      expect(yield* fs.exists(missing)).toBe(false);
      expect((yield* Effect.flip(fs.readFile(missing))).reason._tag).toBe('NotFound');
      expect((yield* Effect.flip(fs.writeFileString(`${missing}/child`, 'data'))).reason._tag).toBe('NotFound');
      expect(yield* fs.exists(missing)).toBe(false);
      yield* fs.writeFileString(`${root}/file`, 'kept');
      expect((yield* Effect.flip(fs.makeDirectory(`${root}/file`))).reason._tag).toBe('AlreadyExists');
      expect((yield* Effect.flip(fs.readDirectory(`${root}/file`))).reason._tag).toBe('BadResource');
      yield* fs.remove(missing, { force: true });
      expect(yield* fs.readFileString(`${root}/file`)).toBe('kept');
    }),
  },

  {
    name: 'recursive copies have independent bytes, respect overwrite and move as directory trees',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      yield* fs.makeDirectory(`${root}/source/child`, { recursive: true });
      yield* fs.writeFileString(`${root}/source/child/file`, 'source');
      yield* fs.symlink('child/file', `${root}/source/link`);
      yield* fs.link(`${root}/source/child/file`, `${root}/source/hard`);
      yield* fs.copy(`${root}/source`, `${root}/copy`);
      yield* fs.writeFileString(`${root}/copy/child/file`, 'changed');
      expect(yield* fs.readFileString(`${root}/source/child/file`)).toBe('source');
      expect(yield* fs.readFileString(`${root}/copy/hard`)).toBe('source');
      expect(yield* fs.readFileString(`${root}/copy/link`)).toBe('source');
      yield* fs.link(`${root}/copy/child/file`, `${root}/alias`);
      yield* fs.writeFileString(`${root}/source/child/new`, 'new');
      yield* fs.copy(`${root}/source`, `${root}/copy`);
      expect(yield* fs.readFileString(`${root}/copy/child/file`)).toBe('changed');
      expect(yield* fs.readFileString(`${root}/copy/child/new`)).toBe('new');
      yield* fs.copy(`${root}/source`, `${root}/copy`, { overwrite: true });
      expect(yield* fs.readFileString(`${root}/copy/child/file`)).toBe('source');
      expect(yield* fs.readFileString(`${root}/alias`)).toBe('changed');
      yield* fs.copyFile(`${root}/source/child/file`, `${root}/file`);
      yield* fs.rename(`${root}/copy`, `${root}/moved`);
      expect(yield* fs.exists(`${root}/copy`)).toBe(false);
      expect(yield* fs.readFileString(`${root}/moved/child/file`)).toBe('source');
      yield* fs.remove(`${root}/moved`, { recursive: true });
      expect(yield* fs.exists(`${root}/moved`)).toBe(false);
      expect(yield* fs.readFileString(`${root}/file`)).toBe('source');
    }),
  },

  {
    name: 'copy creates missing destination parents and refuses a descendant destination before changing the source',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      yield* fs.makeDirectory(`${root}/source`);
      yield* fs.writeFileString(`${root}/source/file`, 'source');
      yield* fs.copy(`${root}/source`, `${root}/new/deep/copy`);
      expect(yield* fs.readFileString(`${root}/new/deep/copy/file`)).toBe('source');
      yield* Effect.flip(fs.copy(`${root}/source`, `${root}/source/new/copy`));
      expect(yield* fs.readDirectory(`${root}/source`)).toEqual(['file']);
    }),
  },

  {
    name: 'hard links share the inode while relative symbolic links resolve from their parent',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      yield* fs.makeDirectory(`${root}/links`);
      yield* fs.writeFileString(`${root}/original`, 'first');
      yield* fs.symlink('../original', `${root}/links/soft`);
      expect(yield* fs.readLink(`${root}/links/soft`)).toBe('../original');
      expect(yield* fs.realPath(`${root}/links/soft`)).toBe(`${root}/original`);
      yield* fs.link(`${root}/original`, `${root}/hard`);
      yield* fs.writeFileString(`${root}/hard`, 'second');
      expect(yield* fs.readFileString(`${root}/links/soft`)).toBe('second');
      expect(Option.getOrThrow((yield* fs.stat(`${root}/hard`)).nlink)).toBe(2);
      yield* fs.remove(`${root}/original`);
      expect(yield* fs.exists(`${root}/links/soft`)).toBe(false);
      expect(yield* fs.readFileString(`${root}/hard`)).toBe('second');
      yield* fs.remove(`${root}/links/soft`);
      expect(Option.getOrThrow((yield* fs.stat(`${root}/hard`)).nlink)).toBe(1);
    }),
  },

  {
    name: 'metadata records modes, byte sizes, ownership and explicit timestamps',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      const path = `${root}/file`;
      yield* fs.writeFileString(path, 'é', { mode: 0o600 });
      yield* fs.chmod(path, 0o640);
      const before = yield* fs.stat(path);
      yield* fs.chown(path, Option.getOrThrow(before.uid), Option.getOrThrow(before.gid));
      yield* fs.utimes(path, 1_000, 2_000);
      const info = yield* fs.stat(path);
      expect(info.type).toBe('File');
      expect(ByteSize.toBigInt(info.size)).toBe(2n);
      expect(info.mode & 0o777).toBe(0o640);
      expect(info.uid).toEqual(before.uid);
      expect(info.gid).toEqual(before.gid);
      expect(Option.getOrThrow(info.atime).getTime()).toBe(1_000_000);
      expect(Option.getOrThrow(info.mtime).getTime()).toBe(2_000_000);
    }),
  },

  {
    name: 'scoped temporary files and directories disappear with their scopes',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      const [directory, file] = yield* Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'dir-' });
          const file = yield* fs.makeTempFileScoped({ directory: root, prefix: 'file-', suffix: '.txt' });
          yield* fs.writeFileString(`${directory}/child`, 'child');
          yield* fs.writeFileString(file, 'temporary');
          expect(file.endsWith('.txt')).toBe(true);
          expect(yield* fs.readFileString(file)).toBe('temporary');
          return [directory, file];
        }),
      );
      expect(yield* fs.exists(directory!)).toBe(false);
      expect(yield* fs.exists(file!)).toBe(false);
      const permanent = yield* fs.makeTempFile({ directory: root });
      expect((yield* fs.stat(permanent)).type).toBe('File');
      expect(yield* fs.readDirectory(root)).toHaveLength(1);
    }),
  },

  {
    name: 'handles keep independent cursors, append at EOF and remain attached across rename and unlink',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      const path = `${root}/file`;
      const file = yield* fs.open(path, { flag: 'w+' });
      expect(yield* file.write(new Uint8Array([1, 2, 3]))).toBe(3);
      expect(yield* file.seek(-2n, 'current')).toBe(1n);
      const second = yield* fs.open(path);
      expect(Option.getOrThrow(yield* second.readAlloc(2))).toEqual(new Uint8Array([1, 2]));
      const buffer = new Uint8Array(4);
      expect(yield* file.read(buffer)).toBe(2);
      expect([...buffer]).toEqual([2, 3, 0, 0]);
      expect((yield* Effect.flip(file.seek(-4n, 'start'))).reason._tag).toBe('BadArgument');
      expect(yield* file.seek(0n, 'current')).toBe(3n);
      yield* file.truncate(1);
      expect(yield* file.seek(0n, 'current')).toBe(1n);
      yield* file.writeAll(new Uint8Array([4]));
      const append = yield* fs.open(path, { flag: 'a+' });
      yield* append.seek(1n, 'start');
      yield* append.writeAll(new Uint8Array([5]));
      expect(yield* append.seek(0n, 'current')).toBe(1n);
      expect(Option.getOrThrow(yield* append.readAlloc(3))).toEqual(new Uint8Array([4, 5]));
      yield* fs.rename(path, `${root}/renamed`);
      yield* fs.remove(`${root}/renamed`);
      yield* file.seek(0n, 'start');
      expect(Option.getOrThrow(yield* file.readAlloc(10))).toEqual(new Uint8Array([1, 4, 5]));
      expect(Option.isNone(yield* file.readAlloc(1))).toBe(true);
      const closed = yield* Effect.scoped(fs.open(`${root}/closed`, { flag: 'w+' }));
      expect((yield* Effect.flip(closed.readAlloc(1)))._tag).toBe('PlatformError');
    }),
  },

  {
    name: 'streams honor byte ranges and sinks persist each chunk in order',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      const path = `${root}/file`;
      yield* Stream.run(Stream.make(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])), fs.sink(path));
      const chunks = yield* Stream.runCollect(fs.stream(path, { offset: 1, bytesToRead: 3, chunkSize: 2 }));
      expect(chunks.flatMap((chunk) => [...chunk])).toEqual([2, 3, 4]);
      expect((yield* Stream.runCollect(fs.stream(path, { bytesToRead: 0 }))).length).toBe(0);
    }),
  },

  {
    name: 'glob walks nested files, braces and exclusions without matching hidden entries implicitly',
    effect: Effect.gen(function* () {
      const { fs, root } = yield* sandbox;
      yield* fs.makeDirectory(`${root}/nested`);
      yield* fs.writeFileString(`${root}/a.ts`, 'a');
      yield* fs.writeFileString(`${root}/nested/b.js`, 'b');
      yield* fs.writeFileString(`${root}/nested/c.ts`, 'c');
      yield* fs.writeFileString(`${root}/.hidden.ts`, 'hidden');
      expect((yield* fs.glob('**/*.{ts,js}', { root, exclude: ['nested/c.ts'] })).sort()).toEqual(['a.ts', 'nested/b.js']);
      expect(yield* fs.glob('.*.ts', { root })).toEqual(['.hidden.ts']);
    }),
  },
];
