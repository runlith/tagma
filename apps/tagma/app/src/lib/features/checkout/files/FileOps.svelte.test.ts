// @vitest-environment jsdom
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { expect, test } from 'vitest';
import { FileOps } from './FileOps.svelte.js';
import { ServerDouble } from './serverDouble.js';

const ROOT = 'root-1' as RootId;

function standing(files: Record<string, string>) {
  const server = new ServerDouble(files);
  const refused: unknown[] = [];
  const ops = new FileOps(
    { aim: { projectId: 1, branch: null }, perform: (id: string, input: Record<string, unknown>) => server.perform(id, input) } as never,
    { row: { path: '/repo', rootId: ROOT } } as never,
    {
      rootId: ROOT,
      selected: { clear: () => undefined },
      draft: null,
      refresh: () => undefined,
      moved: () => undefined,
      hold: () => () => undefined,
      expand: () => undefined,
      reveal: async () => undefined,
      select: () => undefined,
    } as never,
    { retarget: () => undefined, markDeleted: () => undefined, open: () => undefined } as never,
    { settle: async () => () => undefined, relocate: () => undefined } as never,
    { refusal: (error: unknown) => refused.push(error), error: () => undefined, undoable: () => undefined } as never,
    { defer: () => undefined } as never,
  );
  return { ops, server, refused };
}

test('deleting into the trash and undoing it brings the bytes back, and redo deletes them again', async () => {
  const { ops, server } = standing({ 'src/a.ts': 'one\ntwo', 'b.ts': 'b' });

  await ops.trash(['src']);
  expect([...server.files.keys()]).toEqual(['b.ts']);

  await ops.undo();
  expect(server.files.get('src/a.ts')).toBe('one\ntwo');

  await ops.redo();
  expect([...server.files.keys()]).toEqual(['b.ts']);
});

test('a move is undone by the move back; an undo whose target was taken meanwhile is refused and shown, and moves nothing', async () => {
  const { ops, server, refused } = standing({ 'src/a.ts': 'A', 'src/deep/b.ts': 'B' });

  expect(await ops.move([{ from: 'src', to: 'lib' }])).toBe(true);
  expect([...server.files.keys()].sort()).toEqual(['lib/a.ts', 'lib/deep/b.ts']);

  await ops.undo();
  expect([...server.files.keys()].sort()).toEqual(['src/a.ts', 'src/deep/b.ts']);

  await ops.redo();
  server.files.set('src/a.ts', 'taken');
  await ops.undo();

  expect(refused).toHaveLength(1);
  expect([...server.files.keys()].sort()).toEqual(['lib/a.ts', 'lib/deep/b.ts', 'src/a.ts']);
  expect(server.files.get('lib/a.ts')).toBe('A');
});

test('a created file is undone into the trash and redone from it', async () => {
  const { ops, server } = standing({});

  await ops.create('notes/new.ts', 'file');
  expect(server.files.get('notes/new.ts')).toBe('');

  await ops.undo();
  expect(server.files.has('notes/new.ts')).toBe(false);

  await ops.redo();
  expect(server.files.get('notes/new.ts')).toBe('');
});
