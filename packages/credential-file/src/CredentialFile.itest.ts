import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import { makeCredentialFile } from './CredentialFile';
import { CredentialFileFailed, CredentialFileInvalid } from './failure';

type Doc = { readonly secret: string };
const document = Schema.Struct({ secret: Schema.String });

const file = (path: string) =>
  makeCredentialFile<Doc>({
    path,
    codec: {
      empty: () => ({ secret: '' }),
      decode: (at, parsed) =>
        Schema.decodeUnknownEffect(document)(parsed).pipe(
          Effect.map((value) => ({ value, needsWrite: false })),
          Effect.mapError(() => new CredentialFileInvalid({ path: at, reason: 'not a document' })),
        ),
    },
  });

const documentPath = () =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'runlith-credential-file-'))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  ).pipe(Effect.map((directory) => join(directory, 'credentials.json')));

const temporaries = (path: string) => Effect.promise(async () => (await readdir(dirname(path))).filter((name) => name.endsWith('.tmp')));

const persisted = (path: string) => Effect.promise(async () => (JSON.parse(await readFile(path, 'utf8')) as Doc).secret);

const strandRotation = (path: string, secret: string, infix: string | number = 2) =>
  Effect.promise(async () => {
    const live = await stat(path);
    const stranded = `${path}.${infix}.tmp`;
    await writeFile(stranded, JSON.stringify({ secret }), { mode: 0o600 });
    const after = new Date(live.mtimeMs + 1_000);
    await utimes(stranded, after, after);
    return stranded;
  });

it.live('a failed update leaves the stranded rotation recoverable', () =>
  Effect.gen(function* () {
    const path = yield* documentPath();
    const credentials = file(path);
    yield* credentials.update(() => Effect.succeed({ secret: 'landed' }));
    const stranded = yield* strandRotation(path, 'stranded');

    const failure = yield* Effect.flip(
      credentials.update(() => Effect.fail(new CredentialFileFailed({ kind: 'locked', reason: 'refused by the caller' }))),
    );

    expect(failure).toMatchObject({ _tag: 'CredentialFileFailed', kind: 'locked' });
    expect(yield* persisted(stranded)).toBe('stranded');

    expect((yield* credentials.read()).secret).toBe('stranded');
    expect(yield* persisted(path)).toBe('stranded');
    expect(yield* temporaries(path)).toEqual([]);
  }),
);

it.live('a reader already holding the document picks up a rotation another process stranded', () =>
  Effect.gen(function* () {
    const path = yield* documentPath();
    const credentials = file(path);
    yield* credentials.update(() => Effect.succeed({ secret: 'landed' }));
    expect((yield* credentials.read()).secret).toBe('landed');
    yield* strandRotation(path, 'stranded');

    expect((yield* credentials.read()).secret).toBe('stranded');
    expect(yield* persisted(path)).toBe('stranded');
    expect(yield* temporaries(path)).toEqual([]);
  }),
);

it.live('a rotation stranded inside the directory clock’s tick is picked up although the directory stamp did not move', () =>
  Effect.gen(function* () {
    const path = yield* documentPath();
    const credentials = file(path);
    yield* credentials.update(() => Effect.succeed({ secret: 'landed' }));
    expect((yield* credentials.read()).secret).toBe('landed');
    const before = yield* Effect.promise(() => stat(dirname(path)));
    yield* strandRotation(path, 'stranded');
    yield* Effect.promise(() => utimes(dirname(path), before.atime, before.mtime));

    expect((yield* credentials.read()).secret).toBe('stranded');
  }),
);

it.live('an update answering the handed document does not lose the stranded rotation', () =>
  Effect.gen(function* () {
    const path = yield* documentPath();
    const credentials = file(path);
    yield* credentials.update(() => Effect.succeed({ secret: 'landed' }));
    const stranded = yield* strandRotation(path, 'stranded');

    yield* credentials.update((current) => Effect.succeed(current));

    expect(yield* persisted(path)).toBe('landed');
    expect(yield* persisted(stranded)).toBe('stranded');

    expect((yield* credentials.read()).secret).toBe('stranded');
    expect(yield* persisted(path)).toBe('stranded');
    expect(yield* temporaries(path)).toEqual([]);
  }),
);

it.live('a write that fails keeps the adopted temporary carrying this process id', () =>
  Effect.gen(function* () {
    const path = yield* documentPath();
    const credentials = file(path);
    yield* credentials.update(() => Effect.succeed({ secret: 'landed' }));
    const stranded = yield* strandRotation(path, 'stranded', process.pid);
    const aside = `${path}.aside`;

    const failure = yield* credentials
      .update(() =>
        Effect.promise(async () => {
          await rename(path, aside);
          await mkdir(path);
          return { secret: 'rotated' };
        }),
      )
      .pipe(
        Effect.flip,
        Effect.ensuring(
          Effect.promise(async () => {
            await rmdir(path);
            await rename(aside, path);
          }),
        ),
      );

    expect(failure).toMatchObject({ _tag: 'CredentialFileFailed', kind: 'write' });
    expect(yield* persisted(path)).toBe('landed');
    expect(yield* persisted(stranded)).toBe('stranded');

    expect((yield* credentials.read()).secret).toBe('stranded');
    expect(yield* persisted(path)).toBe('stranded');
    expect(yield* temporaries(path)).toEqual([]);
  }),
);

it.live('a temporary planted as a symlink never carries the write through it', () =>
  Effect.gen(function* () {
    const path = yield* documentPath();
    const credentials = file(path);
    yield* credentials.update(() => Effect.succeed({ secret: 'landed' }));
    const target = join(dirname(path), 'outside.txt');
    yield* Effect.promise(() => writeFile(target, 'do-not-touch', { mode: 0o644 }));
    const temporary = `${path}.${process.pid}.tmp`;

    yield* credentials.update(() =>
      Effect.promise(async () => {
        await symlink(target, temporary);
        return { secret: 'rotated' };
      }),
    );

    expect(yield* Effect.promise(() => readFile(target, 'utf8'))).toBe('do-not-touch');
    expect((yield* Effect.promise(() => lstat(path))).isSymbolicLink()).toBe(false);
    expect(yield* persisted(path)).toBe('rotated');
    expect((yield* Effect.promise(() => stat(path))).mode & 0o777).toBe(0o600);
    expect(yield* temporaries(path)).toEqual([]);
  }),
);

it.live('a pre-existing temporary does not lend its mode to the live file', () =>
  Effect.gen(function* () {
    const path = yield* documentPath();
    const credentials = file(path);
    yield* credentials.update(() => Effect.succeed({ secret: 'landed' }));
    const temporary = `${path}.${process.pid}.tmp`;

    yield* credentials.update(() =>
      Effect.promise(async () => {
        await writeFile(temporary, 'stale', { mode: 0o600 });
        await chmod(temporary, 0o644);
        return { secret: 'rotated' };
      }),
    );

    expect((yield* Effect.promise(() => stat(path))).mode & 0o777).toBe(0o600);
    expect(yield* persisted(path)).toBe('rotated');
    expect(yield* temporaries(path)).toEqual([]);
  }),
);
