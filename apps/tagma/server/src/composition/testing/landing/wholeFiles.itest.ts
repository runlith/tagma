import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';

it.live('two sessions whose new declarations use each other land in one commit from either one’s bare submit, naming the other', () =>
  Effect.gen(function* () {
    const { born, doors, write, read } = yield* nativeLanding({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const b = 1;\n' });
    const first = yield* born();
    const second = yield* born();
    const a = 'import { beta } from "./b.js";\nexport const a = 1;\nexport const alpha = () => beta() + 1;\n';
    const b = 'import { alpha } from "./a.js";\nexport const b = 1;\nexport const beta = () => 2;\nexport const both = () => alpha();\n';
    yield* write(first.threadId, 'a.ts', a);
    yield* write(second.threadId, 'b.ts', b);
    expect(yield* doors.atNative('submit_work', { subject: 'land alpha', tasks: [] }, first)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['a.ts', 'b.ts'], carried: [{ path: 'b.ts', holders: [second.threadId] }] } },
    });
    expect([yield* read('a.ts'), yield* read('b.ts')]).toEqual([a, b]);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('files of a language no adapter reads land alone, and a writer whose lines ride brings its other changed files', () =>
  Effect.gen(function* () {
    const { born, doors, write } = yield* nativeLanding({ 'one.txt': 'one\n', 'two.txt': 'two\n', 'three.txt': 'three\n' });
    const caller = yield* born();
    const peer = yield* born();
    yield* write(caller.threadId, 'one.txt', 'one, see two\n');
    yield* write(caller.threadId, 'two.txt', 'two, see one\n');
    yield* write(peer.threadId, 'three.txt', 'three changed\n');
    expect(yield* doors.atNative('submit_work', { subject: 'land the notes', tasks: [] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['one.txt', 'two.txt'], carried: [] } },
    });
    yield* write(peer.threadId, 'two.txt', 'two, see one and three\n');
    yield* write(caller.threadId, 'two.txt', 'two, see one and three, again\n');
    expect(yield* doors.atNative('submit_work', { subject: 'land the second note', tasks: [] }, caller)).toMatchObject({
      class: 'answer',
      value: {
        submitted: {
          status: 'landed',
          committed: ['three.txt', 'two.txt'],
          carried: [
            { path: 'three.txt', holders: [peer.threadId] },
            { path: 'two.txt', holders: [peer.threadId] },
          ],
        },
      },
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a landing that reads a member another writer added carries that writer’s declaration with the caller it updated', () =>
  Effect.gen(function* () {
    const shape = 'export interface Shape {\n  readonly a: number;\n}\n';
    const maker = 'import type { Shape } from "./shape.js";\nexport const make = (): Shape => ({ a: 1 });\n';
    const { born, doors, write, read } = yield* nativeLanding({ 'shape.ts': shape, 'maker.ts': maker });
    const caller = yield* born();
    const peer = yield* born();
    const grown = shape.replace('  readonly a: number;', '  readonly a: number;\n  readonly b: number;');
    const made = maker.replace('({ a: 1 })', '({ a: 1, b: 2 })');
    yield* write(peer.threadId, 'shape.ts', grown);
    yield* write(peer.threadId, 'maker.ts', made);
    const reader = 'import type { Shape } from "./shape.js";\nexport const sum = (shape: Shape) => shape.a + shape.b;\n';
    yield* write(caller.threadId, 'reader.ts', reader);
    expect(yield* doors.atNative('submit_work', { subject: 'read the new member', tasks: [] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['maker.ts', 'reader.ts', 'shape.ts'] } },
    });
    expect([yield* read('shape.ts'), yield* read('maker.ts'), yield* read('reader.ts')]).toEqual([grown, made, reader]);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('in a single checkout a bare submit lands every changed file, whoever wrote it', () =>
  Effect.gen(function* () {
    const { world, projectId, born, doors, write, files, root } = yield* nativeLanding({ 'mine.txt': 'base\n', 'outside.txt': 'base\n' });
    expect(yield* world.op('write_setting', { key: 'agent.checkout', value: 'single' }, `project=${projectId}`)).toMatchObject({
      status: 200,
    });
    const caller = yield* born();
    yield* write(caller.threadId, 'mine.txt', 'mine\n');
    yield* files.writeFileString(join(root, 'outside.txt'), 'outside\n');
    yield* files.writeFileString(join(root, 'fresh.txt'), 'fresh\n');
    expect(yield* doors.atNative('submit_work', { subject: 'land the tree', tasks: [] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['fresh.txt', 'mine.txt', 'outside.txt'] } },
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
