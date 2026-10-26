import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const home = yield* world.stealthProject();
  const root = yield* world.directory('elsewhere');
  const other = yield* world.stealthProject(root);
  yield* projectLeaving(world, home, other);
  const created = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${home}`);
  expect(created.status).toBe(200);
  const thread = (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
  return { world, home, other, root, thread };
});
class SettingsPlace extends Context.Service<SettingsPlace, Effect.Success<typeof setup>>()('testing/SettingsPlace') {}
const KEY = 'orientation.mapBudget';
const STANDING = 6_000;
const asThread = Effect.fnUntraced(function* (input: unknown, query: string) {
  const { world, thread } = yield* SettingsPlace;
  return yield* world.op('write_setting', input, query, { [GRANT_HEADER]: grantFor(thread), [APPROVAL_WAIT_HEADER]: '0' });
});
const written = Effect.fnUntraced(function* (input: unknown, query: string) {
  const first = yield* asThread(input, query);
  return first.status === 409 && (first.body as { code?: string }).code === 'instructions-unread' ? yield* asThread(input, query) : first;
});
const valueIn = Effect.fnUntraced(function* (projectId: number) {
  const { world } = yield* SettingsPlace;
  const read = yield* world.op('read_settings', { section: 'orientation' }, `project=${projectId}`);
  const entries = (read.body as { settings: { entries: { id: string; value: unknown }[] } }).settings.entries;
  return entries.find((entry) => entry.id === KEY)?.value;
});

layer(Layer.effect(SettingsPlace, setup).pipe(Layer.provideMerge(doorFixture())), { excludeTestServices: true })('settings place', (it) => {
  it.effect('foreign settings writes deliver their target law and approval, then address that project by id or checkout', () =>
    Effect.gen(function* () {
      const { world, home, other } = yield* SettingsPlace;
      const rule = 'Foreign mutations must carry this project-specific law';
      expect(yield* world.op('create_block', { tags: ['rule'], title: rule }, `project=${other}`)).toMatchObject({ status: 200 });
      const input = { key: KEY, value: 7_000, project: other };
      const first = yield* asThread(input, '');
      expect(first).toMatchObject({
        status: 409,
        body: { code: 'instructions-unread', reason: expect.stringContaining(rule) },
      });
      expect(yield* valueIn(other)).toBe(STANDING);
      const answer = yield* asThread(input, '');
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({ project: { id: other } });
      expect(yield* valueIn(other)).toBe(7_000);
      expect(yield* valueIn(home)).toBe(STANDING);
      yield* Effect.gen(function* () {
        const { world, home, other } = yield* SettingsPlace;
        const created = yield* world.op('create_thread', { approvalMode: 'trust' }, `project=${home}`);
        expect(created.status).toBe(200);
        const thread = (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
        const settings = yield* world.op('read_settings', {}, `project=${other}`);
        const project = (settings.body as { project: { name: string } }).project;
        const ask = () =>
          world.op('write_setting', { key: 'rules.global.enabled', value: false, project: other }, '', {
            [GRANT_HEADER]: grantFor(thread),
            [APPROVAL_WAIT_HEADER]: '0',
          });
        const first = yield* ask();
        const answer = (first.body as { code?: string }).code === 'instructions-unread' ? yield* ask() : first;
        expect(answer.body).toMatchObject({ code: 'approval-pending' });
        const questions = yield* Context.get(world.runtime.owners, ThreadHarness).runs.questions().open(thread);
        expect(questions.at(-1)?.questions[0]?.prompt).toContain(project.name);
      });
      yield* Effect.gen(function* () {
        const { home, other, root } = yield* SettingsPlace;
        const answer = yield* written({ key: KEY, value: 8_000 }, `cwd=${encodeURIComponent(root)}`);
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ project: { id: other } });
        expect(yield* valueIn(other)).toBe(8_000);
        expect(yield* valueIn(home)).toBe(STANDING);
      });
    }),
  );
});
