import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pluginTemplate } from '@runlith/tagma/plugin/template';
import { Effect } from 'effect';
import { makeDoorWorld } from '../composition/testing/doorFixture.js';

it.live(
  'create_plugin writes the SDK template into the project’s .tagma-plugins/<id>/, or the person’s own outside every repository, and refuses a folder that stands',
  () =>
    Effect.gen(function* () {
      const world = yield* makeDoorWorld({ own: 'it writes into its own project' });
      const root = yield* world.directory('creating');
      const projectId = yield* world.stealthProject(root);
      const scope = `project=${projectId}`;
      const created = yield* world.op('create_plugin', { id: 'gitlab', title: 'GitLab' }, scope);
      const folder = join(realpathSync(root), '.tagma-plugins', 'gitlab');
      expect(created).toMatchObject({ status: 200, body: { status: 'ok', path: folder } });
      for (const file of pluginTemplate({ id: 'gitlab', title: 'GitLab' })) {
        expect(yield* Effect.promise(() => readFile(join(folder, file.path), 'utf8'))).toBe(file.text);
      }
      expect(yield* world.op('create_plugin', { id: 'gitlab', title: 'GitLab again' }, scope)).toMatchObject({
        body: { code: 'plugin-folder-taken' },
      });
      expect(existsSync(join(folder, 'dist'))).toBe(false);

      const own = yield* world.op('create_plugin', { id: 'nord', title: 'Nord', scope: 'user' }, scope);
      expect(own).toMatchObject({ status: 200, body: { status: 'ok' } });
      const mine = (own.body as { readonly path: string }).path;
      expect(mine.endsWith(join('plugins', 'nord'))).toBe(true);
      expect(mine.startsWith(realpathSync(root))).toBe(false);
      for (const file of pluginTemplate({ id: 'nord', title: 'Nord' })) {
        expect(yield* Effect.promise(() => readFile(join(mine, file.path), 'utf8'))).toBe(file.text);
      }
      expect(existsSync(join(root, '.tagma-plugins', 'nord'))).toBe(false);
    }),
);
