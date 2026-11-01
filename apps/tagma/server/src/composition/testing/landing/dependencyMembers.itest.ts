import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';

const INSTALLED = 'node_modules/.bun/effect@4.0.1/node_modules/effect';
const BARREL = 'export * as Context from "./Context.ts";\n';
const CONTEXT_DECLARATIONS = 'export declare const get: <Shape>(context: unknown, key: string) => Shape;\n';

const RIG =
  'export const heard = (lines: readonly string[]) => lines.length;\nexport class Registry {\n  list() {\n    return [];\n  }\n}\n';
const PROXY = [
  'export const trapped = new Proxy({} as Record<string, number>, {',
  '  get(target, key) {',
  '    return Reflect.get(target, String(key));',
  '  },',
  '});',
  '',
].join('\n');
const COSTS = [
  'import { Context } from "effect";',
  'import { heard } from "./rig.js";',
  'export const cost = (owners: unknown) => heard([String(Context.get<number>(owners, "cost"))]);',
  '',
].join('\n');

it.live(
  'native landing ignores a peer member that a barrel-exported library namespace call cannot reach, and still refuses a peer member',
  () =>
    Effect.gen(function* () {
      const { born, doors, write, read, files, root } = yield* nativeLanding(
        { '.gitignore': 'node_modules/\n', 'rig.ts': RIG, 'costs.ts': COSTS },
        { tools: ['submit_work'] },
      );
      yield* files.makeDirectory(join(root, INSTALLED, 'dist'), { recursive: true });
      yield* files.writeFileString(
        join(root, INSTALLED, 'package.json'),
        JSON.stringify({ name: 'effect', exports: { '.': { types: './dist/index.d.ts' } } }),
      );
      yield* files.writeFileString(join(root, INSTALLED, 'dist/index.d.ts'), BARREL);
      yield* files.writeFileString(join(root, INSTALLED, 'dist/Context.d.ts'), CONTEXT_DECLARATIONS);
      yield* files.symlink(join(root, INSTALLED), join(root, 'node_modules/effect'));
      const peer = yield* born();
      const caller = yield* born();
      yield* write(peer.threadId, 'rig.ts', RIG + PROXY);
      const changed = COSTS.replace('"cost"', '"costs"');
      yield* write(caller.threadId, 'costs.ts', changed);

      expect(yield* doors.atNative('submit_work', { subject: 'adjust a library call', paths: ['costs.ts'] }, caller)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['costs.ts'] } },
      });
      expect(yield* read('costs.ts')).toBe(changed);
      expect(yield* read('rig.ts')).toBe(RIG);

      yield* write(peer.threadId, 'rig.ts', RIG.replace('  list() {', '  get(key: string) {\n    return key;\n  }\n  list() {') + PROXY);
      yield* write(
        caller.threadId,
        'costs.ts',
        changed + 'export const found = (registry: import("./rig.js").Registry) => registry.get("k");\n',
      );
      const refused = yield* doors.atNative('submit_work', { subject: 'read a peer registry member', paths: ['costs.ts'] }, caller);
      expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
      if (refused.class === 'refusal') expect(refused.reason).toContain(`get in rig.ts:3, held by ${peer.threadId}`);
      expect(yield* read('costs.ts')).toBe(changed);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);

const KIT = 'node_modules/kit';
const KIT_FILES: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'kit', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } }),
  'dist/index.d.ts': "export * from './core/index.js';\n",
  'dist/index.js': "export * from './core/index.js';\n",
  'dist/core/index.d.ts': "import type { Row } from './row.js';\nexport declare const select: () => Row;\n",
  'dist/core/index.js': 'export const select = () => Object.create(null);\n',
  'dist/core/row.d.ts': 'export interface Row {\n  readonly at: number;\n}\n',
  'dist/core/row.js': 'export {};\n',
};
const SHARED = 'export const base = 1;\n';
const READER = [
  "import { select } from 'kit';",
  "import type { Inbox } from './inbox.ts';",
  "import { base } from './shared.ts';",
  "export const read = (inbox: Inbox['Service']) => inbox.writes + select().at + base;",
  '',
].join('\n');

it.live('native landing places an inherited member and a library type behind a star export and a declaration file', () =>
  Effect.gen(function* () {
    const { born, doors, write, read, files, root } = yield* nativeLanding(
      {
        '.gitignore': 'node_modules/\n',
        'service.ts': 'export const Service = <Shape>() => class {\n  declare readonly Service: Shape;\n};\n',
        'inbox.ts': "import { Service } from './service.ts';\nexport class Inbox extends Service<{ readonly writes: number }>() {}\n",
        'shared.ts': SHARED,
      },
      { tools: ['submit_work'] },
    );
    for (const [path, text] of Object.entries(KIT_FILES)) {
      yield* files.makeDirectory(join(root, KIT, path, '..'), { recursive: true });
      yield* files.writeFileString(join(root, KIT, path), text);
    }
    const peer = yield* born();
    const caller = yield* born();
    yield* write(peer.threadId, 'shared.ts', SHARED + 'export const writes = 2;\nexport const at = 3;\n');
    yield* write(caller.threadId, 'reader.ts', READER);

    expect(yield* doors.atNative('submit_work', { subject: 'read the inbox', paths: ['reader.ts'] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['reader.ts'] } },
    });
    expect(yield* read('reader.ts')).toBe(READER);
    expect(yield* read('shared.ts')).toBe(SHARED);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

const WALKS = 'export const makeWalks = () => 1;\n';
const PRIVATE_LANES =
  'type ReadyJob<A> = { readonly lane: string; readonly value: A };\nexport class WorkLanes<A> {\n  first(): ReadyJob<A> | undefined {\n    return undefined;\n  }\n}\n';
const SHAPE = [
  'export type Some = { readonly _tag: "Some"; readonly value: { readonly kind: string } };',
  'export const head = (_rows: unknown): Some | null => null;',
  'export const headOf = <A>(_rows: A): Some | null => null;',
  '',
].join('\n');
const SEARCH = ['declare const loose: any;', 'declare function pick(x: string): number;', 'declare function pick(x: number): string;'].join(
  '\n',
);
const FEED = [
  'import { head } from "./shape.ts";',
  'import { makeWalks } from "./walks.ts";',
  SEARCH,
  'const first = head(pick(loose));',
  'export const kind = first === null ? null : first.value.kind;',
  'export const walks = makeWalks;',
  '',
].join('\n');

it.live('native landing settles a receiver behind a fixed call and still refuses one behind a generic call', () =>
  Effect.gen(function* () {
    const { born, doors, write, read } = yield* nativeLanding(
      { '.gitignore': 'node_modules/\n', 'walks.ts': WALKS, 'shape.ts': SHAPE, 'feed.ts': FEED },
      { tools: ['submit_work'] },
    );
    const peer = yield* born();
    const caller = yield* born();
    yield* write(peer.threadId, 'walks.ts', WALKS + PRIVATE_LANES);
    const grown = FEED + 'export const more = 1;\n';
    yield* write(caller.threadId, 'feed.ts', grown);

    expect(yield* doors.atNative('submit_work', { subject: 'grow the feed', paths: ['feed.ts'] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['feed.ts'] } },
    });
    expect(yield* read('feed.ts')).toBe(grown);
    expect(yield* read('walks.ts')).toBe(WALKS);

    const generic = grown
      .replace('import { head }', 'import { head, headOf }')
      .concat('const second = headOf(pick(loose));\nexport const other = second === null ? null : second.value.kind;\n');
    yield* write(caller.threadId, 'feed.ts', generic);
    const refused = yield* doors.atNative('submit_work', { subject: 'read through a generic', paths: ['feed.ts'] }, caller);
    expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
    if (refused.class === 'refusal') expect(refused.reason).toContain(`value in walks.ts:2, held by ${peer.threadId}`);
    expect(yield* read('feed.ts')).toBe(grown);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

const LIBRARY = JSON.stringify({ name: 'lib', exports: { '.': './src/server.ts', './compiler': './src/compiler.ts' } });
const SERVER = 'export type Component = () => void;\n';
const CLIENT = [
  "import type { Component } from 'lib';",
  "import type { Format } from 'lib/compiler';",
  'export interface Boot {',
  '  readonly root: Component;',
  '  readonly format: Format;',
  '}',
  '',
].join('\n');

it.live('native landing places a type re-exported by another published entry than the one a peer extends', () =>
  Effect.gen(function* () {
    const { born, doors, write, read, files, root } = yield* nativeLanding(
      {
        '.gitignore': 'node_modules/\n',
        'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
        'packages/lib/package.json': LIBRARY,
        'packages/lib/src/shared/format.ts': 'export type Format = { readonly prefix: string };\n',
        'packages/lib/src/compiler.ts': "export type { Format } from './shared/format.ts';\n",
        'packages/lib/src/server.ts': SERVER,
        'packages/app/package.json': JSON.stringify({ name: 'app', dependencies: { lib: 'workspace:*' } }),
      },
      { tools: ['submit_work'] },
    );
    yield* files.makeDirectory(join(root, 'packages/app/node_modules'), { recursive: true });
    yield* files.symlink('../../lib', join(root, 'packages/app/node_modules/lib'));
    const peer = yield* born();
    const caller = yield* born();
    yield* write(peer.threadId, 'packages/lib/src/server.ts', SERVER + "export type { Format } from './shared/format.ts';\n");
    yield* write(caller.threadId, 'packages/app/client.ts', CLIENT);

    expect(
      yield* doors.atNative('submit_work', { subject: 'define the client contract', paths: ['packages/app/client.ts'] }, caller),
    ).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed', committed: ['packages/app/client.ts'] } } });
    expect(yield* read('packages/app/client.ts')).toBe(CLIENT);
    expect(yield* read('packages/lib/src/server.ts')).toBe(SERVER);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
