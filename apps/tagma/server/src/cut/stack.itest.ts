import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { bundle } from '@runlith/bundle/bundle';
import { decodeStack } from './stack.js';

const world = realpathSync(mkdtempSync(join(tmpdir(), 'stack with space-')));
afterAll(() => rmSync(world, { recursive: true, force: true }));

const wrote = (path: string, text: string): string => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
};

it.live('a stack thrown by a minified release bundle reads back in its source files and lines, from the map of the bundle that threw', () =>
  Effect.gen(function* () {
    const entry = wrote(
      join(world, 'src/main.ts'),
      `import { fail } from './lib/fail';\n\nexport function outer(n: number) {\n  return fail(n * 2);\n}\nouter(3);\n`,
    );
    wrote(
      join(world, 'src/lib/fail.ts'),
      'export function fail(value: number): number {\n  const told = `value ${value}`;\n  if (value > 1) {\n    throw new Error(told);\n  }\n  return value;\n}\n',
    );
    const [built] = yield* bundle(entry, 'main.js', { sourcemap: 'external', comments: 'none', minify: true });
    const program = wrote(join(world, 'release/bin/server/main.js'), built!.text);
    const maps = join(world, 'shelf');
    wrote(join(maps, 'bin/server/main.js.map'), built!.map!);
    wrote(join(maps, 'bin/cli/main.js.map'), JSON.stringify({ version: 3, sources: ['other.ts'], mappings: '' }));

    const ran = Bun.spawnSync([process.execPath, program], { stderr: 'pipe', stdout: 'ignore' });
    const stack = ran.stderr.toString();
    expect(stack).not.toMatch(/fail\.ts:\d+/u);

    const decoded = yield* Effect.promise(() => decodeStack(maps, stack, world));

    expect(decoded.text).toMatch(/\(src\/lib\/fail\.ts:4:\d+\)/u);
    expect(decoded.text).toMatch(/ src\/main\.ts:6:\d+/u);
  }),
);

it.live('a frame on generated code the map marks unmapped stays as it was thrown, and a surface URL frame reads like a path', () =>
  Effect.gen(function* () {
    const maps = join(world, 'unmapped');
    wrote(join(maps, 'surface/_app/edge.js.map'), JSON.stringify({ version: 3, sources: [join(world, 'edge.ts')], mappings: 'AAAA,K' }));
    const stack = '    at a (http://127.0.0.1:4317/_app/edge.js:1:1)\n    at http://127.0.0.1:4317/_app/edge.js:1:6\n';

    const decoded = yield* Effect.promise(() => decodeStack(maps, stack, world));

    expect(decoded.text).toBe('    at a (edge.ts:1:1)\n    at http://127.0.0.1:4317/_app/edge.js:1:6\n');
  }),
);
