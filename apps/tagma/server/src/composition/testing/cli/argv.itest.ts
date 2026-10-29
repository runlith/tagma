import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { makeTerminalWorld } from '../fixture.js';

const shared = Effect.gen(function* () {
  const world = yield* makeTerminalWorld();
  return { world, checkout: yield* world.checkout() };
});
class ArgvPlace extends Context.Service<ArgvPlace, Effect.Success<typeof shared>>()('testing/ArgvPlace') {}
const tagma = (argv: readonly string[]) => Effect.flatMap(ArgvPlace, ({ world, checkout }) => world.tagma(argv, { cwd: checkout.root }));
const rootName = Effect.fnUntraced(function* () {
  const roots = yield* tagma(['op', 'list_root_blocks', '--json']);
  expect(roots.code).toBe(0);
  return (JSON.parse(roots.out) as { blocks: { name: string }[] }).blocks[0]!.name;
});
const createdName = (answer: { code: number; out: string }): string => {
  expect(answer.code).toBe(0);
  const body = JSON.parse(answer.out) as { status: string; block: { name: string } };
  expect(body.status).toBe('ok');
  return body.block.name;
};

layer(Layer.merge(Layer.effect(ArgvPlace, shared), BunFileSystem.layer), { excludeTestServices: true })('CLI operation inputs', (it) => {
  it.effect('op posts inline JSON and prints the catalog answer', () =>
    Effect.gen(function* () {
      const born = yield* tagma([
        'op',
        '--json',
        'create_block',
        JSON.stringify({ title: 'inline operation input', parentId: yield* rootName() }),
      ]);
      expect(createdName(born)).toMatch(/^[0-9a-f]{8}$/);
    }),
  );

  it.effect('op reads a relative JSON file and refuses invalid input sources', () =>
    Effect.gen(function* () {
      const { checkout } = yield* ArgvPlace;
      const files = yield* FileSystem.FileSystem;
      yield* files.writeFileString(
        join(checkout.root, 'operation-input.json'),
        `${JSON.stringify({ title: 'file operation input', parentId: yield* rootName() })}\n`,
      );
      const born = yield* tagma(['op', 'create_block', '--json', '--project', checkout.name, 'operation-input.json']);
      expect(createdName(born)).toMatch(/^[0-9a-f]{8}$/);
      for (const source of ['{bad', 'missing-operation-input.json']) {
        const invalid = yield* tagma(['op', 'create_block', '--json', source]);
        expect(invalid.code).toBe(2);
        expect(JSON.parse(invalid.out)).toMatchObject({ code: 'input-invalid' });
      }
    }),
  );

  it.effect('a real process reads its JSON from stdin when input is dash', () =>
    Effect.gen(function* () {
      const { world, checkout } = yield* ArgvPlace;
      const born = yield* world.spawned(['op', 'create_block', '--json', '--project', checkout.name, '-'], {
        cwd: checkout.root,
        stdin: JSON.stringify({ title: 'stdin operation input', parentId: yield* rootName() }),
      });
      expect(createdName(born)).toMatch(/^[0-9a-f]{8}$/);
    }),
  );

  it.effect('a real process answers a refusal as JSON on stdout at exit 2', () =>
    Effect.gen(function* () {
      const { world, checkout } = yield* ArgvPlace;
      const refused = yield* world.spawned(['op', '--json', 'nothing_named_this'], { cwd: checkout.root });
      expect(refused.code).toBe(2);
      expect(JSON.parse(refused.out)).toMatchObject({ code: 'unknown-operation' });
    }),
  );

  it.effect('op uses its explicit scope to locate the project from outside every checkout', () =>
    Effect.gen(function* () {
      const { world, checkout } = yield* ArgvPlace;
      const scope = createdName(
        yield* tagma([
          'op',
          'create_block',
          '--json',
          '--project',
          checkout.name,
          JSON.stringify({ title: 'scope for operation input', parentId: yield* rootName() }),
        ]),
      );
      const unscoped = yield* world.tagma(['op', 'read_tree', '--json'], { cwd: '/' });
      expect(unscoped.code).toBe(2);
      expect(JSON.parse(unscoped.out)).toMatchObject({ code: 'project-required' });
      const scoped = yield* world.tagma(['op', 'read_tree', '--json', '--scope', scope], { cwd: '/' });
      expect(scoped.code).toBe(0);
      expect(JSON.parse(scoped.out)).toMatchObject({
        status: 'ok',
        blocks: expect.arrayContaining([expect.objectContaining({ name: scope })]),
      });
    }),
  );
});
