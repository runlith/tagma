import { expect } from 'bun:test';
import { resolve } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema } from 'effect';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { fixtureEntries } from '../../../plugin-host/testing/tools.js';
import { ThreadList } from '../../../threads/contract/service/list.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';

const FIXTURE = resolve(import.meta.dir, '../../../plugin-host/testing/fixture.ts');
const decodeSnapshot = Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema);
const caller = (id: string): Readonly<Record<string, string>> => ({ 'x-tagma-caller': `plugin:${id}` });

const installed = Effect.fnUntraced(function* (
  world: DoorFixture['Service'],
  projectId: number,
  id: string,
  contributes: Readonly<Record<string, unknown>>,
) {
  const folder = yield* world.directory(`${id}-plugin`);
  yield* Effect.promise(() => writePlugin(folder, { id, program: FIXTURE, contributes: { tools: fixtureEntries({}), ...contributes } }));
  const answer = yield* world.op('install_plugin', { source: folder }, `project=${projectId}`);
  expect(answer.body).toMatchObject({ plugin: { id, enabled: true } });
  yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id }, `project=${projectId}`).pipe(Effect.orDie));
});

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  const projectId = yield* world.plainProject();
  yield* projectLeaving(world, projectId);
  yield* installed(world, projectId, 'quiet', {});
  yield* installed(world, projectId, 'loud', { threads: { listed: true } });
  return { world, account, projectId };
});

class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/PluginListingWorld') {}

layer(Layer.effect(World, setup).pipe(Layer.provide(doorFixture())), { excludeTestServices: true })('plugin thread listing', (it) => {
  it.effect('the general list leaves out the threads of a plugin that does not list them, and the plugin lists its own by binding', () =>
    Effect.gen(function* () {
      const { world, account, projectId } = yield* World;
      const at = `project=${projectId}`;
      const made = (plugin: string) =>
        Effect.map(
          Effect.flatMap(world.op('create_thread', { title: `${plugin} thread`, account }, at, caller(plugin)), (created) =>
            decodeSnapshot(created.body),
          ),
          ({ snapshot }) => snapshot.thread.id,
        );
      const quiet = yield* made('quiet');
      const loud = yield* made('loud');
      const { thread: person } = yield* birthsOf(world.runtime.owners).create({
        projectId,
        createdBySessionId: null,
        title: 'person thread',
        account,
      });
      const personId = person.id;
      const listed = (selection: Readonly<Record<string, unknown>>) =>
        Effect.map(world.op('list_threads', { ...selection, shape: 'facts' }, at), (answer) => {
          const body = answer.body as { readonly threads: readonly { readonly id: string }[] };
          return body.threads.map((one) => one.id).sort();
        });
      expect(yield* listed({})).toEqual([loud, personId].sort());
      expect(yield* listed({ plugin: 'quiet' })).toEqual([quiet]);
      expect(yield* listed({ plugin: 'loud' })).toEqual([loud]);
      expect(yield* listed({ ids: [quiet, loud, personId] })).toEqual([quiet, loud, personId].sort());
    }),
  );

  it.effect('a plugin switched off or removed in the project leaves its threads ordinary in the general list', () =>
    Effect.gen(function* () {
      const { world, account, projectId } = yield* World;
      const at = `project=${projectId}`;
      yield* installed(world, projectId, 'ghost', {});
      const made = yield* Effect.map(
        Effect.flatMap(world.op('create_thread', { title: 'ghost thread', account }, at, caller('ghost')), (created) =>
          decodeSnapshot(created.body),
        ),
        ({ snapshot }) => snapshot.thread.id,
      );
      const everyone = () =>
        Effect.map(world.op('list_threads', { limit: 50, shape: 'facts' }, at), (answer) =>
          (answer.body as { readonly threads: readonly { readonly id: string }[] }).threads.map((one) => one.id),
        );
      expect(yield* everyone()).not.toContain(made);
      expect((yield* world.op('enable_plugin', { id: 'ghost', enabled: false, scope: 'project' }, at)).status).toBe(200);
      expect(yield* everyone()).toContain(made);
      expect((yield* world.op('enable_plugin', { id: 'ghost', enabled: true, scope: 'project' }, at)).status).toBe(200);
      expect(yield* everyone()).not.toContain(made);
      expect((yield* world.op('uninstall_plugin', { id: 'ghost' }, at)).status).toBe(200);
      expect(yield* everyone()).toContain(made);
    }),
  );

  it.effect('a hidden plugin thread leaves the lists but its row still reaches the Attention listeners', () =>
    Effect.gen(function* () {
      const { world, account, projectId } = yield* World;
      const at = `project=${projectId}`;
      const hidden = yield* Effect.map(
        Effect.flatMap(world.op('create_thread', { title: 'quiet attention', account }, at, caller('quiet')), (created) =>
          decodeSnapshot(created.body),
        ),
        ({ snapshot }) => snapshot.thread.id,
      );
      const live = Context.get(world.runtime.owners, ThreadList);
      const inLists: string[] = [];
      const inAttention: string[] = [];
      const leaveList = live.subscribe(projectId, (event) => {
        if (event.kind === 'row' || event.kind === 'removed')
          inLists.push(`${event.kind}:${event.kind === 'row' ? event.row.id : event.threadId}`);
      });
      const leaveAttention = live.subscribeAttention((event) => {
        if (event.kind === 'row') inAttention.push(event.row.id);
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => (leaveList(), leaveAttention())));
      yield* live.announceThread(hidden);
      expect(inLists).toContain(`removed:${hidden}`);
      expect(inLists).not.toContain(`row:${hidden}`);
      expect(inAttention).toContain(hidden);
    }),
  );

  it.effect('the live window leaves out a hidden plugin child under a visible parent and shows it once the plugin is off', () =>
    Effect.gen(function* () {
      const { world, account, projectId } = yield* World;
      const at = `project=${projectId}`;
      const { thread: person } = yield* birthsOf(world.runtime.owners).create({
        projectId,
        createdBySessionId: null,
        title: 'parent thread',
        account,
      });
      const child = yield* Effect.map(
        Effect.flatMap(world.op('create_thread', { parent: person.id, name: 'quiet child', task: '' }, at, caller('quiet')), (created) =>
          decodeSnapshot(created.body),
        ),
        ({ snapshot }) => snapshot.thread.id,
      );
      const window = () =>
        Effect.map(world.op('list_thread_window', {}, at), (answer) =>
          (answer.body as { readonly rows: readonly { readonly id: string }[] }).rows.map((row) => row.id),
        );
      const opened = yield* window();
      expect(opened).toContain(person.id);
      expect(opened).not.toContain(child);
      const live = Context.get(world.runtime.owners, ThreadList);
      expect((yield* live.openWindow(projectId)).rows.map((row) => row.id)).not.toContain(child);
      expect((yield* world.op('enable_plugin', { id: 'quiet', enabled: false, scope: 'project' }, at)).status).toBe(200);
      yield* Effect.addFinalizer(() => world.op('enable_plugin', { id: 'quiet', enabled: true, scope: 'project' }, at).pipe(Effect.orDie));
      expect(yield* window()).toContain(child);
    }),
  );
});
