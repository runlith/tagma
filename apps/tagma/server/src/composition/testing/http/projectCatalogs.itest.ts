import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { InstalledCatalogs, Tags } from '../../../graph/contract/service/vocabulary.js';
import { CORE_LIBRARY } from '../../../graph/contract/wire/tags/identity.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { graphCatalogs } from '../../../catalogs/contract/wire/settings.js';

type Born = { project: { id: number; name: string } };

const installedOf = Effect.fnUntraced(function* (projectId: number) {
  const world = yield* DoorFixture;
  const served = yield* world.runtime.pool.resolve({ projectId });
  const installed = yield* Context.get(served.context, InstalledCatalogs).read(projectId);
  const table = yield* Context.get(served.context, Tags).of(projectId);
  return { ids: new Set(installed.map((catalog) => catalog.id)), bindsCode: table.bindsCode() };
});

const projectLayerOf = Effect.fnUntraced(function* (projectId: number) {
  const world = yield* DoorFixture;
  const read = yield* world.op('read_settings', {}, `project=${projectId}`);
  const entries = (read.body as { settings: { entries: { id: string; layers: { project?: { value?: unknown } } }[] } }).settings.entries;
  return entries.find((entry) => entry.id === 'graph.catalogs')?.layers.project?.value;
});

const bornWith = Effect.fnUntraced(function* (label: string, catalogs?: readonly string[]) {
  const world = yield* DoorFixture;
  const created = yield* world.op('add_project', {
    name: world.uniqueName(),
    rootPath: yield* world.directory(label),
    storage: 'stealth',
    catalogs,
  });
  expect(created.status).toBe(200);
  return (created.body as Born).project.id;
});

layer(doorFixture(), { excludeTestServices: true })('project catalogs', (it) => {
  it.effect('a project is born with the catalogs its creator chose, and keeps them once the machine default would add more', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const book = yield* bornWith('book', ['knowledge']);
      expect(yield* installedOf(book)).toEqual({ ids: new Set([CORE_LIBRARY, 'knowledge']), bindsCode: false });
      expect(yield* projectLayerOf(book)).toEqual([CORE_LIBRARY, 'knowledge']);
      const bare = yield* bornWith('bare', []);
      expect(yield* installedOf(bare)).toEqual({ ids: new Set([CORE_LIBRARY]), bindsCode: false });
      expect(yield* projectLayerOf(bare)).toEqual([CORE_LIBRARY]);
      yield* world.runtime.pool.releaseProject(bare);
      expect((yield* installedOf(bare)).ids).toEqual(new Set([CORE_LIBRARY]));
    }),
  );

  it.effect("a set chosen at birth stays the project's own after the machine default changes, even when the two matched at birth", () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const settings = Context.get(world.runtime.owners, Settings);
      const previous = (yield* settings.read(graphCatalogs)).layers.user;
      yield* Effect.addFinalizer(() =>
        settings.write({ scope: 'user', key: graphCatalogs.id, value: previous?.value, declined: previous?.declined }).pipe(Effect.orDie),
      );
      const listed = yield* world.op('list_projects', {});
      const home = (listed.body as { projects: { id: number; global: boolean }[] }).projects.find((row) => row.global);
      if (home === undefined) return yield* Effect.die(new Error('the fixture registered no global project'));
      const chosen = yield* bornWith('matched', ['software-development']);
      expect(yield* projectLayerOf(chosen)).toEqual([CORE_LIBRARY, 'software-development']);
      const changed = yield* world.op(
        'write_setting_layer',
        { scope: 'user', key: 'graph.catalogs', value: ['knowledge', CORE_LIBRARY] },
        `project=${home.id}`,
      );
      expect(changed.status).toBe(200);
      yield* world.runtime.pool.releaseProject(chosen);
      expect(yield* installedOf(chosen)).toEqual({ ids: new Set([CORE_LIBRARY, 'software-development']), bindsCode: true });
      expect(yield* projectLayerOf(chosen)).toEqual([CORE_LIBRARY, 'software-development']);
    }),
  );

  it.effect('an unknown catalog refuses the registration whole, naming the catalog', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const name = world.uniqueName();
      const refused = yield* world.op('add_project', {
        name,
        rootPath: yield* world.directory('unknown'),
        storage: 'stealth',
        catalogs: ['knowledge', 'nowhere'],
      });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'unknown-catalog' });
      const listed = yield* world.op('list_projects', {});
      expect((listed.body as { projects: Born['project'][] }).projects.map((row) => row.name)).not.toContain(name);
    }),
  );
});
