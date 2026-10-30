import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schema, Stream } from 'effect';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { ROUTE_OPERATIONS } from '../../../threads/contract/wire/operations/routes.js';
import { FOLDER_OPERATIONS } from '../../../threads/contract/wire/operations/folders.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';

const created = Schema.decodeUnknownEffect(knownAnswer(ROUTE_OPERATIONS.create_thread.answer));
const folderCreated = Schema.decodeUnknownEffect(knownAnswer(FOLDER_OPERATIONS.create_thread_folder.answer));
const folderList = Schema.decodeUnknownEffect(knownAnswer(FOLDER_OPERATIONS.list_thread_folders.answer));
const listed = Schema.decodeUnknownEffect(knownAnswer(ROUTE_OPERATIONS.list_thread_window.answer));

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: (selection) => ({ ...standing.request(selection), stream: () => Stream.never }),
  }),
});

layer(fixture, { excludeTestServices: true })('the thread list and folders of a group', (it) => {
  it.effect(
    'a group lists every member’s threads and both members’ folders, same names kept apart; leaving gives each project its own threads, a shared folder to both',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        yield* nativeLeads(world, yield* subscriptionLogin(world));
        yield* holdThreads(world);
        const alpha = yield* world.plainProject();
        const beta = yield* world.plainProject();
        yield* projectLeaving(world, alpha, beta);
        const at = (projectId: number) => `project=${projectId}`;
        const birth = Effect.fnUntraced(function* (projectId: number, title: string) {
          const answer = yield* created((yield* world.op('create_thread', { title, approvalMode: 'bypass' }, at(projectId))).body);
          return answer.snapshot.thread.id;
        });
        const folder = Effect.fnUntraced(function* (projectId: number, name: string, threadIds: readonly string[]) {
          return (yield* folderCreated((yield* world.op('create_thread_folder', { name, threadIds }, at(projectId))).body)).folder;
        });
        const folders = Effect.fnUntraced(function* (projectId: number) {
          return (yield* folderList((yield* world.op('list_thread_folders', {}, at(projectId))).body)).folders;
        });
        const rows = Effect.fnUntraced(function* (projectId: number) {
          const answer = yield* listed((yield* world.op('list_thread_window', {}, at(projectId))).body);
          return new Map(answer.rows.map((row) => [row.id, row.folderId ?? null] as const));
        });

        const ours = yield* birth(alpha, 'alpha work');
        const theirs = yield* birth(beta, 'beta work');
        const site = yield* folder(alpha, 'Site', [ours]);
        const twin = yield* folder(beta, 'Site', []);

        const made = yield* world.op('make_group', { name: world.uniqueName(), projects: [String(alpha), String(beta)] });
        expect(made.status).toBe(200);
        const groupId = (made.body as { group: { graph: { id: number } } }).group.graph.id;

        expect((yield* folders(groupId)).map((one) => [one.id, one.name, one.parentId])).toEqual([
          [site.id, 'Site', null],
          [twin.id, 'Site', null],
        ]);
        expect(yield* rows(groupId)).toEqual(
          new Map([
            [ours, site.id],
            [theirs, null],
          ]),
        );
        expect([...(yield* rows(alpha)).keys()]).toEqual([ours]);
        expect((yield* world.op('file_threads', { threadIds: [theirs], folderId: site.id }, at(beta))).body).toMatchObject({
          status: 'filed',
        });

        expect((yield* world.op('leave_group', { project: String(beta) })).body).toMatchObject({ group: null });
        expect((yield* folders(alpha)).map((one) => [one.id, one.name])).toEqual([[site.id, 'Site']]);
        expect(yield* rows(alpha)).toEqual(new Map([[ours, site.id]]));
        const returned = yield* folders(beta);
        expect(returned.map((one) => one.name)).toEqual(['Site', 'Site']);
        const copy = returned.find((one) => one.id !== twin.id);
        expect(returned.some((one) => one.id === twin.id)).toBe(true);
        expect(copy?.id).not.toBe(site.id);
        expect(yield* rows(beta)).toEqual(new Map([[theirs, copy?.id ?? null]]));
      }),
  );
});
