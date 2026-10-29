import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { TerminalFixture, terminalFixture, type TerminalCheckout } from '../composition/testing/fixture.js';

const opIn = Effect.fnUntraced(function* (cwd: string, id: string, input: unknown, project?: string) {
  const world = yield* TerminalFixture;
  return yield* world.tagma(['op', id, '--json', ...(project === undefined ? [] : ['--project', project]), JSON.stringify(input)], { cwd });
});
const op = (checkout: TerminalCheckout, id: string, input: unknown) => opIn(checkout.root, id, input, checkout.name);
const created = Effect.fnUntraced(function* (checkout: TerminalCheckout, input: Record<string, unknown>) {
  const born = yield* op(checkout, 'create_block', input);
  expect(born.code).toBe(0);
  return (JSON.parse(born.out) as { block: { name: string } }).block.name;
});

layer(Layer.merge(terminalFixture, BunFileSystem.layer), { excludeTestServices: true })('document operations', (it) => {
  it.effect('an apply_batch input names the project it lands in, and refuses when nothing does', () =>
    Effect.gen(function* () {
      const world = yield* TerminalFixture;
      const checkout = yield* world.checkout();
      const files = yield* FileSystem.FileSystem;
      const roots = yield* op(checkout, 'list_root_blocks', {});
      const root = (JSON.parse(roots.out) as { blocks: { name: string }[] }).blocks[0]!.name;
      const area = yield* created(checkout, { tags: ['idea'], title: 'landing area', parentId: root });
      const elsewhere = yield* world.directory('outside');
      const document = join(elsewhere, 'document.json');
      yield* files.writeFileString(
        document,
        JSON.stringify({ ops: [{ op: 'create', tags: ['idea'], title: 'landed by name', parentId: area }] }),
      );
      const homeless = yield* opIn(elsewhere, 'apply_batch', { file: document });
      expect(homeless.code).toBe(2);
      expect(JSON.parse(homeless.out)).toMatchObject({ code: 'project-required' });
      const named = yield* opIn(elsewhere, 'apply_batch', { file: document }, checkout.name);
      expect(named.code).toBe(0);
      const searched = yield* opIn(elsewhere, 'search_blocks', { query: 'landed by name' }, checkout.name);
      expect((JSON.parse(searched.out) as { blocks: unknown[] }).blocks[0]).toMatchObject({
        title: 'landed by name',
        parentTitle: 'landing area',
      });
    }),
  );
});
