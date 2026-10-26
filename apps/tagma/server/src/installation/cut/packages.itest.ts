import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { carryPackages, writeInstallationPackage } from './packages.js';

const tree = realpathSync(mkdtempSync('/tmp/cut-packages-'));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const run = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem>) => work.pipe(Effect.provide(BunFileSystem.layer));
const wrote = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

it.live('carried package links keep their targets after the checkout is removed and the closure moves', () =>
  Effect.gen(function* () {
    const source = join(tree, 'checkout');
    const first = join(source, 'one');
    const second = join(source, 'two');
    const cut = join(tree, 'cut');
    wrote(join(first, 'lib/value.js'), 'export const value = 1;');
    wrote(join(second, 'value.js'), 'export const value = 2;');
    symlinkSync(first, join(first, 'self'));
    symlinkSync('lib/value.js', join(first, 'local.js'));
    symlinkSync('../two/value.js', join(first, 'sibling.js'));
    yield* run(
      carryPackages(
        [
          { name: 'one', from: first },
          { name: '@scope/two', from: second },
        ],
        cut,
      ),
    );
    rmSync(source, { recursive: true });
    const moved = join(tree, 'moved');
    renameSync(cut, moved);
    expect(readFileSync(join(moved, 'node_modules/one/self/lib/value.js'), 'utf8')).toBe('export const value = 1;');
    expect(readFileSync(join(moved, 'node_modules/one/local.js'), 'utf8')).toBe('export const value = 1;');
    expect(readFileSync(join(moved, 'node_modules/one/sibling.js'), 'utf8')).toBe('export const value = 2;');
    expect(realpathSync(join(moved, 'node_modules/one/self'))).toBe(join(moved, 'node_modules/one'));
  }),
);

it.live('a package link to an uncarried dependency refuses at the copy boundary', () =>
  Effect.gen(function* () {
    const source = join(tree, 'external');
    wrote(join(source, 'one/value.js'), 'export const value = 1;');
    wrote(join(source, 'two/value.js'), 'export const value = 2;');
    symlinkSync('../two/value.js', join(source, 'one/dependency.js'));
    const refused = yield* run(Effect.flip(carryPackages([{ name: 'one', from: join(source, 'one') }], join(tree, 'refused'))));
    expect(refused).toContain(join(source, 'two/value.js'));
  }),
);

it.live('the installation manifest names the server and its version, never what only the checkout builds with', () =>
  Effect.gen(function* () {
    const server = join(tree, 'manifest/server/package.json');
    const into = join(tree, 'manifest/root/package.json');
    wrote(
      server,
      JSON.stringify({
        name: '@tagma/server',
        version: '0.1.0',
        type: 'module',
        scripts: { build: 'bun build' },
        devDependencies: { '@runlith/developer-adapter': 'workspace:*' },
      }),
    );
    mkdirSync(dirname(into), { recursive: true });
    yield* run(writeInstallationPackage(server, into));
    expect(JSON.parse(readFileSync(into, 'utf8'))).toEqual({ name: '@tagma/server', version: '0.1.0', type: 'module' });
  }),
);
