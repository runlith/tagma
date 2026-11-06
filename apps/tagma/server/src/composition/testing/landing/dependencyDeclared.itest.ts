import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { nativeLanding } from './native.js';

const MANIFEST = 'export type Manifest = { readonly name: string };\nexport const manifest = (one: Manifest) => one;\n';
const FILLS = MANIFEST.replace('string }', 'string; readonly fills?: number }');
const USER = "import { manifest } from './manifest.ts';\nexport const user = manifest({ name: 'user' });\n";
const GROWN = USER + 'export const more = 1;\n';
const FILLED = FILLS + 'export const fillsOf = (one: Manifest) => one.fills ?? 0;\n';
const NEEDING = GROWN + "import { fillsOf } from './manifest.ts';\nexport const filled = fillsOf({ name: 'user' });\n";

it.live('native landing carries a peer file only for a declaration the landing uses, and none of that peer’s other files', () =>
  Effect.gen(function* () {
    const { born, doors, write, read } = yield* nativeLanding(
      { '.gitignore': 'node_modules/\n', 'manifest.ts': MANIFEST, 'user.ts': USER },
      { tools: ['submit_work'] },
    );
    const peer = yield* born();
    const caller = yield* born();
    yield* write(peer.threadId, 'manifest.ts', FILLS);
    yield* write(peer.threadId, 'unrelated.ts', 'export const unrelated = 1;\n');
    yield* write(caller.threadId, 'user.ts', GROWN);

    expect(yield* doors.atNative('submit_work', { subject: 'grow the user', paths: ['user.ts'] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['user.ts'] } },
    });
    expect(yield* read('manifest.ts')).toBe(MANIFEST);

    yield* write(peer.threadId, 'manifest.ts', FILLED);
    yield* write(caller.threadId, 'user.ts', NEEDING);
    expect(yield* doors.atNative('submit_work', { subject: 'read the fills', paths: ['user.ts'] }, caller)).toMatchObject({
      class: 'answer',
      value: {
        submitted: {
          status: 'landed',
          committed: ['manifest.ts', 'user.ts'],
          carried: [{ path: 'manifest.ts', holders: [peer.threadId] }],
        },
      },
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
