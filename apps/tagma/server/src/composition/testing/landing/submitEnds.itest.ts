import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
type World = Effect.Success<ReturnType<typeof makeCheckout>>;
const crlf = (lines: readonly string[]) => `${lines.join('\r\n')}\r\n`;
const THEIRS_LINES = [FILE[0] as string, 'const two = 2; // theirs', ...FILE.slice(2)];
const BOTH = [...THEIRS_LINES.slice(0, 4), 'const five = 5; // mine'];
const MINE_LINES = [...FILE.slice(0, 4), 'const five = 5; // mine'];
const NEW = ['const b = 1;', 'const c = 2;'];
const underUserConfig = Effect.fnUntraced(function* <A, E, R>(config: string, act: () => Effect.Effect<A, E, R>) {
  const files = yield* FileSystem.FileSystem;
  const dir = yield* files.makeTempDirectoryScoped({ prefix: 'user-config-' });
  const file = join(dir, 'gitconfig');
  yield* files.writeFileString(file, config);
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => {
      const was = process.env.GIT_CONFIG_GLOBAL;
      process.env.GIT_CONFIG_GLOBAL = file;
      return was;
    }),
    () => Effect.suspend(act),
    (was) =>
      Effect.sync(() => {
        if (was === undefined) delete process.env.GIT_CONFIG_GLOBAL;
        else process.env.GIT_CONFIG_GLOBAL = was;
      }),
  );
}, Effect.scoped);
const addedBlob = (world: World, path: string, text: string): string =>
  Bun.spawnSync(['git', '-C', world.root, 'hash-object', '--stdin', `--path=${path}`], {
    stdin: Buffer.from(text),
    env: { ...process.env },
  })
    .stdout.toString()
    .trim();
const landsAsAdded = Effect.fnUntraced(function* (world: World, path: string, lines: readonly string[]) {
  expect([path, yield* world.run(['rev-parse', `HEAD:${path}`])]).toEqual([path, addedBlob(world, path, crlf(lines))]);
});
const commitBase = Effect.fnUntraced(function* (world: World, files: Readonly<Record<string, string>>) {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(world.root, path), text);
  yield* world.run(['add', '--', ...Object.keys(files)]);
  yield* world.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'the base']);
});
const holdBoth = Effect.fnUntraced(function* (world: World, path: string) {
  writeFileSync(join(world.root, path), crlf(BOTH));
  yield* world.record(THEIRS, crlf(FILE), crlf(THEIRS_LINES), { path });
  yield* world.record(MINE, crlf(THEIRS_LINES), crlf(BOTH), { path });
});
const holdNew = Effect.fnUntraced(function* (world: World) {
  writeFileSync(join(world.root, 'src', 'b.ts'), crlf(NEW));
  yield* world.record(MINE, '', crlf(NEW), { path: 'src/b.ts', origin: 'write' });
});
layer(Layer.merge(checkoutFixture, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  it.effect(
    'under core.autocrlf=true and a clean filter in the user config, own lines, filtered own lines and whole files land as the user’s git add stores them',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* commitBase(world, { 'src/.gitattributes': 'c.ts filter=upper\n', 'src/c.ts': `${FILE.join('\n')}\n` });
          yield* underUserConfig(
            '[core]\n\tautocrlf = true\n[filter "upper"]\n\tclean = tr a-z A-Z\n',
            Effect.fnUntraced(function* () {
              yield* holdBoth(world, 'src/a.ts');
              yield* holdBoth(world, 'src/c.ts');
              yield* holdNew(world);
              const answer = yield* world.submit(MINE);
              expect(answer.status).toBe('landed');
              if (answer.status !== 'landed') return;
              expect(answer.carried).toEqual([]);
              expect(yield* world.run(['cat-file', 'blob', 'HEAD:src/a.ts'])).toBe(MINE_LINES.join('\n'));
              expect(yield* world.run(['cat-file', 'blob', 'HEAD:src/b.ts'])).toBe(NEW.join('\n'));
              expect(yield* world.run(['cat-file', 'blob', 'HEAD:src/c.ts'])).toBe(MINE_LINES.join('\n').toUpperCase());
              for (const [path, lines] of [
                ['src/a.ts', MINE_LINES],
                ['src/b.ts', NEW],
                ['src/c.ts', MINE_LINES],
              ] as const)
                yield* landsAsAdded(world, path, lines);
            }),
          );
        })(),
      ),
  );
  it.effect(
    'under core.autocrlf=true, a file the session staged itself and landed in part is brought level with the commit in the index',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* underUserConfig(
            '[core]\n\tautocrlf = true\n',
            Effect.fnUntraced(function* () {
              yield* holdBoth(world, 'src/a.ts');
              Bun.spawnSync(['git', '-C', world.root, 'add', '--', 'src/a.ts'], { env: { ...process.env } });
              const answer = yield* world.submit(MINE);
              expect(answer.status).toBe('landed');
              if (answer.status !== 'landed') return;
              expect(answer.carried).toEqual([]);
              expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('');
            }),
          );
        })(),
      ),
  );
  it.effect('under core.autocrlf=true with `* -text`, own lines and whole files keep CRLF as the user’s git add does', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* commitBase(world, { '.gitattributes': '* -text\n', 'src/a.ts': crlf(FILE) });
        yield* underUserConfig(
          '[core]\n\tautocrlf = true\n',
          Effect.fnUntraced(function* () {
            yield* holdBoth(world, 'src/a.ts');
            yield* holdNew(world);
            const answer = yield* world.submit(MINE);
            expect(answer.status).toBe('landed');
            if (answer.status !== 'landed') return;
            expect(answer.carried).toEqual([]);
            expect(yield* world.run(['cat-file', 'blob', 'HEAD:src/a.ts'])).toBe(MINE_LINES.join('\r\n'));
            expect(yield* world.run(['cat-file', 'blob', 'HEAD:src/b.ts'])).toBe(NEW.join('\r\n'));
            for (const [path, lines] of [
              ['src/a.ts', MINE_LINES],
              ['src/b.ts', NEW],
            ] as const)
              yield* landsAsAdded(world, path, lines);
          }),
        );
      })(),
    ),
  );
});
