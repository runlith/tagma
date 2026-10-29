import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';

const HOST = 'export interface Host {\n  firstEnded(): void;\n}\n';
const SUCCESSION = 'export interface Succession {\n  ready: boolean;\n}\n';
const SERVER = [
  'import type { Host } from "./host.js";',
  'import type { Succession } from "./succession.js";',
  'import type { ScrollBehavior, VirtualItem } from "@tanstack/virtual-core";',
  'export const phase = (value: number) => value;',
  'export const read = (host: any, refused: any) => {',
  '  host.firstEnded();',
  '  return refused.detail;',
  '};',
  '',
].join('\n');
const BOUND =
  '\nexport const doorBound = phase(1);\nexport const scroll = (item: VirtualItem, behavior: ScrollBehavior) => `${item.key}:${behavior}`;\n';
const INSTALLED = 'node_modules/.bun/@tanstack+virtual-core@3.19.8/node_modules/@tanstack/virtual-core';
const DECLARATIONS = 'export type ScrollBehavior = "auto" | "smooth";\nexport interface VirtualItem {\n  key: string | number;\n}\n';
const PATCH = 'patches/@tanstack%2Fvirtual-core@3.19.8.patch';
const PATCH_TEXT =
  'diff --git a/dist/esm/index.d.ts b/dist/esm/index.d.ts\n--- a/dist/esm/index.d.ts\n+++ b/dist/esm/index.d.ts\n@@ -1,1 +1,2 @@\n export type ScrollBehavior = "auto" | "smooth";\n+export declare const isScrollWriteBlocked: boolean;\n';
const EXISTING = 'export type Existing = string;\nexport type Other = number;\n';
const IMPORTER =
  'import type {\n  Existing as Imported\n} from "./clean.js";\nimport type * as API\n  from "./clean.js";\nexport type Shape = Imported | API.Other;\n';
const PEER = 'export const marker = 0;\n';

it.live('native landing carries dependency patches, excludes ignored declarations, and still checks selected peer source references', () =>
  Effect.gen(function* () {
    const { born, doors, write, read, files, root } = yield* nativeLanding(
      {
        '.gitignore': 'node_modules/\n',
        'host.ts': HOST,
        'succession.ts': SUCCESSION,
        'server.ts': SERVER,
        'clean.ts': EXISTING,
        'peer.ts': PEER,
        'importer.ts': IMPORTER,
      },
      { tools: ['check_rules', 'submit_work'] },
    );
    yield* files.makeDirectory(join(root, INSTALLED, 'dist/esm'), { recursive: true });
    yield* files.writeFileString(
      join(root, INSTALLED, 'package.json'),
      JSON.stringify({ name: '@tanstack/virtual-core', types: 'dist/esm/index.d.ts' }),
    );
    yield* files.writeFileString(join(root, INSTALLED, 'dist/esm/index.d.ts'), DECLARATIONS);
    yield* files.makeDirectory(join(root, 'node_modules/@tanstack'), { recursive: true });
    yield* files.symlink(join(root, INSTALLED), join(root, 'node_modules/@tanstack/virtual-core'));
    const peer = yield* born();
    const caller = yield* born();
    yield* write(peer.threadId, `${INSTALLED}/dist/esm/index.d.ts`, `${DECLARATIONS}export declare const isScrollWriteBlocked: boolean;\n`);
    yield* write(caller.threadId, PATCH, PATCH_TEXT);
    yield* write(peer.threadId, 'host.ts', HOST.replace('firstEnded', 'hostEnded'));
    yield* write(peer.threadId, 'succession.ts', SUCCESSION.replace('  ready', '  detail: string;\n  refused: boolean;\n  ready'));
    const foreign = SERVER.replace('firstEnded', 'hostEnded');
    yield* write(peer.threadId, 'server.ts', foreign);
    yield* write(caller.threadId, 'server.ts', foreign + BOUND);

    expect(
      yield* doors.atNative('submit_work', { subject: 'bind an independent door', paths: ['server.ts', PATCH], whole: [PATCH] }, caller),
    ).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: [PATCH, 'server.ts'], carried: [] } },
    });
    expect(yield* read(PATCH)).toBe(PATCH_TEXT);
    expect(yield* read('server.ts')).toBe(SERVER + BOUND);
    expect(yield* read('host.ts')).toBe(HOST);
    expect(yield* read('succession.ts')).toBe(SUCCESSION);
    expect(yield* files.readFileString(join(root, 'server.ts'))).toBe(foreign + BOUND);

    yield* write(caller.threadId, 'server.ts', foreign + BOUND + 'export const use = (host: any) => host.hostEnded();\n');
    yield* write(peer.threadId, 'peer.ts', PEER + EXISTING);
    const shared = IMPORTER + 'export const peerMarker = 1;\n';
    yield* write(peer.threadId, 'importer.ts', shared);
    yield* write(caller.threadId, 'importer.ts', shared.replaceAll('./clean.js', './peer.js'));
    for (const id of ['check_rules', 'submit_work']) {
      const refused = yield* doors.atNative(id, id === 'check_rules' ? { over: 'change' } : { subject: 'use a peer member' }, caller);
      expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
      if (refused.class === 'refusal') {
        expect(refused.reason).toContain(`hostEnded in host.ts:2, held by ${peer.threadId}`);
        expect(refused.reason).toContain(`Existing in peer.ts:2, held by ${peer.threadId}`);
        expect(refused.reason).toContain(`Other in peer.ts:3, held by ${peer.threadId}`);
      }
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
