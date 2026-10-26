import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema } from 'effect';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import type { SettingEntry } from '../../../settings/contract/wire/catalog.js';
import { threadTypesSchema } from '../../../threads/contract/wire/birth.js';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const root = realpathSync(yield* world.directory('thread-type'));
  const projectId = yield* world.stealthProject(root);
  yield* projectLeaving(world, projectId);
  const floor = join(root, '.agents');
  mkdirSync(floor, { recursive: true });
  return { projectId, floor };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ThreadTypes') {}

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(doorFixture())), { excludeTestServices: true })('thread types door', (it) => {
  it.effect('registered modes reach the menu and settings, and a project default agent reaches the next birth', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const { projectId, floor } = yield* Place;
      const modes = Context.get(world.runtime.owners as Context.Context<ApprovalModes>, ApprovalModes);
      const plan = { id: 'plan', label: 'Plan', description: 'Proposes before it acts.', icon: 'eye', strictness: 3 };
      yield* Effect.acquireRelease(modes.register('test', plan), (remove) => Effect.sync(remove));
      const catalog = yield* world.op('read_settings', {}, `project=${projectId}`);
      expect(catalog.status).toBe(200);
      const entry = (catalog.body as { settings: { entries: readonly SettingEntry[] } }).settings.entries.find(
        (row) => row.id === 'agent.approvalMode',
      );
      expect(entry?.control).toMatchObject({
        kind: 'choice',
        choices: expect.arrayContaining([{ value: plan.id, label: plan.label, hint: plan.description }]),
      });
      writeFileSync(join(floor, 'tutor.md'), '---\ndescription: Teaches.\ncapabilities: [graph]\n---\nYou teach one task at a time.\n');
      yield* Effect.addFinalizer(() => Effect.asVoid(world.op('write_setting', { key: 'agent.default' }, `project=${projectId}`)));
      expect((yield* world.op('write_setting', { key: 'agent.default', value: 'tutor' }, `project=${projectId}`)).status).toBe(200);
      const birth = yield* world.op('list_thread_types', {}, `project=${projectId}`);
      expect(birth.status).toBe(200);
      const page = yield* Schema.decodeUnknownEffect(threadTypesSchema)(birth.body);
      expect(page.default).toBe('tutor');
      expect(page.modes).toContainEqual(plan);
      const opened = yield* world.op('create_thread', { title: 'lesson' }, `project=${projectId}`);
      expect(opened.status).toBe(200);
      const listed = yield* world.op('list_threads', { shape: 'rows', limit: 1 }, `project=${projectId}`);
      expect(
        (listed.body as { rows: { agentId: string; profileId: string | null }[] }).rows.map((row) => [row.agentId, row.profileId]),
      ).toEqual([['tutor', 'tutor']]);
    }),
  );
});
