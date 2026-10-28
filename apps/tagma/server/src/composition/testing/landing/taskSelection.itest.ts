import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { nativeLanding } from './native.js';

it.live('submit_work attributes only declared tasks when paths lands one of two held tasks, and an omitted declaration names none', () =>
  Effect.gen(function* () {
    const { world, projectId, root, born, doors, write, read } = yield* nativeLanding({
      'first.ts': 'export const first = 1;\n',
      'second.ts': 'export const second = 1;\n',
    });
    const caller = yield* born();
    const tasks: string[] = [];
    for (const title of ['First task', 'Second task']) {
      const created = yield* world.op('create_block', { tags: ['task'], title }, `project=${projectId}`);
      const name = (created.body as { block: { name: string } }).block.name;
      tasks.push(name);
      const claim = () => world.op('claim_block', { blockId: name }, `project=${projectId}`, { [GRANT_HEADER]: caller.grant });
      const claimed = yield* claim();
      expect(claimed.status === 200 ? claimed : yield* claim()).toMatchObject({ status: 200 });
    }
    yield* write(caller.threadId, 'first.ts', 'export const first = 2;\n');
    yield* write(caller.threadId, 'second.ts', 'export const second = 2;\n');
    const unnamed = yield* doors.atNative('submit_work', { subject: 'Fix an unrelated detail', paths: ['first.ts'] }, caller);
    expect(unnamed).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', subject: 'Fix an unrelated detail', unnamedTasks: tasks } },
    });
    if (unnamed.class !== 'answer') return;
    expect((unnamed.value as { submitted: { tasks?: unknown } }).submitted.tasks).toBeUndefined();
    const firstHead = yield* spawnedEffect(['git', 'log', '-1', '--format=%s'], { cwd: root });
    expect(firstHead.exitCode).toBe(0);
    expect(new TextDecoder().decode(firstHead.stdout).trim()).toBe('Fix an unrelated detail');

    yield* write(caller.threadId, 'first.ts', 'export const first = 3;\n');
    const selected = yield* doors.atNative(
      'submit_work',
      { subject: 'Complete the first task', body: 'Attribute only the declared task.', paths: ['first.ts'], tasks: [tasks[0]] },
      caller,
    );
    expect(selected).toMatchObject({
      class: 'answer',
      value: {
        submitted: {
          status: 'landed',
          subject: 'Complete the first task',
          committed: ['first.ts'],
          left: ['second.ts'],
          tasks: [{ name: tasks[0], holder: caller.threadId, by: 'session' }],
        },
      },
    });
    if (selected.class !== 'answer') return;
    expect((selected.value as { submitted: { tasks: readonly unknown[] } }).submitted.tasks).toHaveLength(1);
    const selectedHead = yield* spawnedEffect(['git', 'log', '-1', '--format=%B'], { cwd: root });
    expect(selectedHead.exitCode).toBe(0);
    expect(new TextDecoder().decode(selectedHead.stdout).trim()).toBe(
      `Complete the first task\n\nAttribute only the declared task.\n\nTask: ${tasks[0]} First task\nCo-authored-by: Tagma <agent@tagma.dev>`,
    );
    const trailers = yield* spawnedEffect(['git', 'log', '-1', '--format=%(trailers:only,unfold)'], { cwd: root });
    expect(new TextDecoder().decode(trailers.stdout).trim()).toBe(`Task: ${tasks[0]} First task\nCo-authored-by: Tagma <agent@tagma.dev>`);
    expect(yield* read('second.ts')).toBe('export const second = 1;\n');

    const unheld = yield* world.op('create_block', { tags: ['task'], title: 'Unheld task' }, `project=${projectId}`);
    const unheldName = (unheld.body as { block: { name: string } }).block.name;
    const refused = yield* doors.atNative('submit_work', { subject: 'Reject an unheld task', tasks: [unheldName] }, caller);
    expect(refused).toMatchObject({ class: 'refusal', code: 'task-not-held' });
    if (refused.class === 'refusal') expect(refused.unblock.length).toBeGreaterThan(0);
    const noTasks = yield* doors.atNative('submit_work', { subject: 'Leave tasks unnamed', tasks: [] }, caller);
    expect(noTasks).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed', subject: 'Leave tasks unnamed' } } });
    if (noTasks.class === 'answer') {
      const receipt = (noTasks.value as { submitted: { tasks?: unknown; unnamedTasks?: unknown } }).submitted;
      expect(receipt.tasks).toBeUndefined();
      expect(receipt.unnamedTasks).toBeUndefined();
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('submit_work names the declared work of a single held task without sources, and commits.coAuthor off drops Tagma', () =>
  Effect.gen(function* () {
    const { world, projectId, root, born, doors, write } = yield* nativeLanding({ 'value.ts': 'export const value = 1;\n' });
    const caller = yield* born();
    expect(yield* world.op('write_setting', { key: 'commits.coAuthor', value: false }, `project=${projectId}`)).toMatchObject({
      status: 200,
    });
    const created = yield* world.op('create_block', { tags: ['task'], title: 'Single task' }, `project=${projectId}`);
    const task = (created.body as { block: { name: string } }).block.name;
    const claim = () => world.op('claim_block', { blockId: task }, `project=${projectId}`, { [GRANT_HEADER]: caller.grant });
    const claimed = yield* claim();
    expect(claimed.status === 200 ? claimed : yield* claim()).toMatchObject({ status: 200 });
    yield* write(caller.threadId, 'value.ts', 'export const value = 2;\n');
    expect(yield* doors.atNative('submit_work', { tasks: [task] }, caller)).toMatchObject({
      class: 'answer',
      value: {
        submitted: { status: 'landed', subject: 'Single task', tasks: [{ name: task, holder: caller.threadId, by: 'session' }] },
      },
    });
    const head = yield* spawnedEffect(['git', 'log', '-1', '--format=%B'], { cwd: root });
    expect(head.exitCode).toBe(0);
    expect(new TextDecoder().decode(head.stdout).trim()).toBe(`Single task\n\nTask: ${task} Single task`);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
