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
