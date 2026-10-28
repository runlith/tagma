import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { MCP_SESSION_HEADER } from '../../../platform/contract/wire/session.js';
import { nativeLanding } from './native.js';

const OUTSIDE = { [MCP_SESSION_HEADER]: 'claude-code:outside' };

it.live(
  'a Claude Code session outside Tagma lands only the paths it names, keeps a peer’s separate lines uncommitted, carries a peer block it edited inside with its author, and is refused no-record without paths',
  () =>
    Effect.gen(function* () {
      const notes = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
      const shown = 'export const shown = (words: string[]) => {\n  return words;\n};\n';
      const { world, born, write, read, files, root, projectId } = yield* nativeLanding({ 'notes.txt': notes, 'shown.ts': shown });
      const at = `project=${projectId}`;
      const peer = yield* born();
      const created = yield* world.op('create_block', { tags: ['task'], title: 'Outside work' }, at, OUTSIDE);
      const task = (created.body as { block: { name: string } }).block.name;
      const claim = () => world.op('claim_block', { blockId: task }, at, OUTSIDE);
      const claimed = yield* claim();
      expect(claimed.status === 200 ? claimed : yield* claim()).toMatchObject({ status: 200 });
      const peers = notes.replace('one\n', 'ONE\n');
      yield* write(peer.threadId, 'notes.txt', peers);
      const outside = peers.replace('seven\n', 'SEVEN\n');
      yield* files.writeFileString(join(root, 'notes.txt'), outside);
      yield* files.writeFileString(join(root, 'added.txt'), 'added outside\n');
      expect(
        (yield* world.op(
          'submit_work',
          { paths: ['notes.txt', 'added.txt'], subject: 'land the outside edit', tasks: [task] },
          at,
          OUTSIDE,
        )).body,
      ).toMatchObject({
        submitted: {
          status: 'landed',
          subject: 'land the outside edit',
          committed: ['added.txt', 'notes.txt'],
          carried: [],
          tasks: [{ name: task, holder: 'claude-code:outside', by: 'session' }],
        },
      });
      expect(yield* read('notes.txt')).toBe(notes.replace('seven\n', 'SEVEN\n'));
      expect(yield* read('added.txt')).toBe('added outside\n');
      expect(yield* files.readFileString(join(root, 'notes.txt'))).toBe(outside);

      const block = shown.replace('  return words;', '  for (const word of words) {\n    console.log(word);\n  }\n  return words;');
      yield* write(peer.threadId, 'shown.ts', block);
      const trimmed = block.replace('    console.log(word);', '    console.log(word.trim());');
      yield* files.writeFileString(join(root, 'shown.ts'), trimmed);
      expect((yield* world.op('submit_work', { paths: ['shown.ts'], subject: 'trim logged words' }, at, OUTSIDE)).body).toMatchObject({
        submitted: { status: 'landed', committed: ['shown.ts'], carried: [{ path: 'shown.ts', holders: [peer.threadId] }] },
      });
      expect(yield* read('shown.ts')).toBe(trimmed);

      for (const op of ['submit_work', 'check_rules'])
        expect((yield* world.op(op, {}, at, OUTSIDE)).body).toMatchObject({ code: 'no-record' });
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
