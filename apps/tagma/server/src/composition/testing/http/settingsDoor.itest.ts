import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

type Catalog = { entries: { id: string; value: unknown; from: string }[] };
const entry = (body: unknown, id: string) => (body as { settings: Catalog }).settings.entries.find((row) => row.id === id);

layer(doorFixture(), { excludeTestServices: true })('settings door', (it) => {
  it.effect('a setting written through either operation is read in its project, and a value equal to the default clears its layer', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const root = yield* world.directory('settings');
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      const at = `cwd=${encodeURIComponent(root)}`;
      const key = 'agent.contextFiles.names';
      const fresh = yield* world.op('read_settings', {}, at);
      expect(fresh.status).toBe(200);
      const inherited = entry(fresh.body, key);
      expect(inherited).toMatchObject({ value: ['TAGMA.md', 'AGENTS.md', 'CLAUDE.md'], from: 'default' });

      const written = yield* world.op('write_setting', { key, value: ['AGENTS.md'] }, at);
      expect(written).toMatchObject({ status: 200, body: { key, value: ['AGENTS.md'], from: 'project' } });
      const read = yield* world.op('read_settings', {}, at);
      expect(read.status).toBe(200);
      expect(entry(read.body, key)).toMatchObject({ value: ['AGENTS.md'], from: 'project' });

      const restored = yield* world.op('write_setting_layer', { scope: 'project', key, value: inherited!.value }, at);
      expect(restored.status).toBe(200);
      expect(entry(restored.body, key)).toMatchObject({ value: inherited!.value, from: 'default' });
      const refused = yield* world.op('write_setting_layer', { scope: 'project', key: 'agent.contextFiles.enabled', value: 'yes' }, at);
      expect(refused).toMatchObject({ status: 409, body: { code: 'setting-value' } });

      const layoutKey = 'terminal.placeLayouts';
      const terminal = {
        places: {
          'execution-root': {
            order: ['execution:1'],
            tabs: {
              'execution:1': {
                title: null,
                tree: { kind: 'pane', id: 'execution:1' },
                labels: {},
                holder: '01a19917-0000-7000-8000-000000000001',
                holderProject: project,
              },
            },
            closed: [],
          },
        },
      };
      const laid = yield* world.op('write_setting', { key: layoutKey, value: terminal }, at);
      expect(laid).toMatchObject({ status: 200, body: { key: layoutKey, value: terminal } });
      const reopened = yield* world.op('read_settings', {}, at);
      expect(entry(reopened.body, layoutKey)).toMatchObject({ value: terminal, from: 'project' });
    }),
  );

  it.effect('the user layer is written with no project named, and a project layer still needs one', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const written = yield* world.op('write_setting_layer', { scope: 'user', key: 'appearance.mode', value: 'light' });
      expect(written).toMatchObject({ status: 200, body: { status: 'written' } });
      const refused = yield* world.op('write_setting_layer', { scope: 'project', key: 'agent.contextFiles.names', value: ['AGENTS.md'] });
      expect(refused.body).toMatchObject({ code: 'project-required' });

      const root = yield* world.directory('user-layer');
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      const read = yield* world.op('read_settings', {}, `cwd=${encodeURIComponent(root)}`);
      expect(entry(read.body, 'appearance.mode')).toMatchObject({ value: 'light', from: 'user' });
    }),
  );
});
