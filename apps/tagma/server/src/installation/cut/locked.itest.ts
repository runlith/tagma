import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { lockedPackages } from './locked.js';

const tree = mkdtempSync('/tmp/cut-locked-');
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const spawning = Layer.mergeAll(
  BunFileSystem.layer,
  BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
const wrote = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const NAME = 'vendor-native';
const VERSION = '1.0.0';

const registry = async () => {
  const source = join(tree, 'source');
  wrote(join(source, 'package/package.json'), JSON.stringify({ name: NAME, version: VERSION }));
  wrote(join(source, 'package/bin/tool'), 'the vendor binary');
  const archive = join(tree, 'package.tgz');
  const packed = Bun.spawnSync(['/usr/bin/tar', '-czf', archive, '-C', source, 'package']);
  expect(packed.exitCode).toBe(0);
  const bytes = readFileSync(archive);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      requests.push(new URL(request.url).pathname);
      return new Response(bytes);
    },
  });
  const checkout = join(tree, 'checkout');
  wrote(join(checkout, 'bun.lock'), JSON.stringify({ packages: { [`${NAME}@${VERSION}`]: [`${NAME}@${VERSION}`, '', {}, integrity] } }));
  const parent = join(tree, 'parent');
  wrote(join(parent, 'package.json'), JSON.stringify({ name: 'parent', version: '1.0.0', optionalDependencies: { [NAME]: VERSION } }));
  afterAll(() => void server.stop(true));
  return { checkout, parent, requests, url: `http://localhost:${server.port}` };
};

const world = registry();

it.live('a cached package is taken once fetched, and two writers racing on an empty cache both get the verified tree', () =>
  Effect.gen(function* () {
    const { checkout, parent, requests, url } = yield* Effect.promise(() => world);
    const cache = join(tree, 'cache-race');
    const resolve = lockedPackages(checkout, cache, url).pipe(Effect.flatMap((packages) => packages(parent, NAME)));
    const both = yield* Effect.all([resolve, resolve], { concurrency: 2 });
    expect(both[0]).toBe(both[1]);
    expect(readFileSync(join(both[0], 'bin/tool'), 'utf8')).toBe('the vendor binary');
    const before = requests.length;
    expect(yield* resolve).toBe(both[0]);
    expect(requests.length).toBe(before);
  }).pipe(Effect.provide(spawning)),
);

const tamperings: ReadonlyArray<readonly [string, (root: string) => void]> = [
  ['an edited file', (root) => appendFileSync(join(root, 'bin/tool'), ' plus attacker bytes')],
  ['an extra file', (root) => wrote(join(root, 'bin/extra'), 'planted')],
  ['a file turned into a link', (root) => (rmSync(join(root, 'bin/tool')), symlinkSync('/usr/bin/true', join(root, 'bin/tool')))],
];

for (const [what, tamper] of tamperings) {
  it.live(`a published cache entry with ${what} is refused, never used`, () =>
    Effect.gen(function* () {
      const { checkout, parent, url } = yield* Effect.promise(() => world);
      const cache = join(tree, `cache-${what.replaceAll(' ', '-')}`);
      const packages = yield* lockedPackages(checkout, cache, url);
      tamper(yield* packages(parent, NAME));
      const refused = yield* Effect.flip(packages(parent, NAME));
      expect(refused).toContain(cache);
    }).pipe(Effect.provide(spawning)),
  );
}
