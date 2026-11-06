import { expect } from 'bun:test';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { fixtureEntries } from '../../../plugin-host/testing/tools.js';
import type { DoorFixture } from '../doorFixture.js';

export const FIXTURE_PROGRAM = resolve(import.meta.dir, '../../../plugin-host/testing/fixture.ts');

export type FixturePlugin = {
  readonly id: string;
  readonly title?: string;
  readonly resident?: boolean;
  readonly contributes?: Readonly<Record<string, unknown>>;
};

export const installedFixture = Effect.fnUntraced(function* (
  world: Pick<DoorFixture['Service'], 'directory' | 'op'>,
  projectId: number,
  plugin: FixturePlugin,
) {
  const { id } = plugin;
  const folder = yield* world.directory(`${id}-plugin`);
  const contributes = { tools: fixtureEntries({}), ...plugin.contributes };
  yield* Effect.promise(() =>
    writePlugin(folder, { id, title: plugin.title, program: FIXTURE_PROGRAM, resident: plugin.resident, contributes }),
  );
  const answer = yield* world.op('install_plugin', { source: folder }, `project=${projectId}`);
  expect(answer.body).toMatchObject({ plugin: { id, enabled: true } });
  yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id }, `project=${projectId}`).pipe(Effect.orDie));
});
