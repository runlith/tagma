import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { MCP_SESSION_HEADER } from '../../../platform/contract/wire/session.js';
import { callerInThread } from '../callers.js';
import { git } from '../threadDoors.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { nativeLanding } from './native.js';

const call = Effect.fnUntraced(function* (tool: Tool, thread: string, input: unknown) {
  const invocation = { toolCallId: crypto.randomUUID(), caller: callerInThread(thread, 'run'), messages: [] };
  const prepared = yield* toolPrepare(tool)!(input, invocation);
  const answer = yield* toolExecute(tool)!(input, { ...invocation, prepared: prepared.prepared });
  tool.settled?.(invocation);
  return answer instanceof ToolAnswer ? answer.value : answer;
});

const staleMonitor = Effect.fnUntraced(function* (root: string, seen: readonly string[] = []) {
  const files = yield* FileSystem.FileSystem;
  const hook = join(root, '.git', 'hooks', 'stale-monitor');
  yield* files.writeFileString(hook, `#!/bin/sh\nprintf 'stale\\0${seen.map((path) => `${path}\\0`).join('')}'\n`);
  yield* files.chmod(hook, 0o755);
  yield* git(root, 'config', 'core.fsmonitor', hook);
  yield* git(root, 'status', '--porcelain', '--untracked-files=no');
});

const tree = Effect.fnUntraced(function* (root: string) {
  const listed = yield* spawnedEffect(['git', 'ls-tree', '--name-only', 'HEAD'], { cwd: root });
  return new TextDecoder().decode(listed.stdout);
});

it.live(
  'under a stale fsmonitor a landed file is still its deletion, a peer’s landing leaves a hidden delete and edit held, and explicit paths lands an unrecorded delete',
  () =>
    Effect.gen(function* () {
      const { world, born, doors, root, projectId, write } = yield* nativeLanding({
        'base.txt': 'base\n',
        'removed.txt': 'removed\n',
        'edited.txt': 'before\n',
        'peer.txt': 'peer\n',
        'named.txt': 'named\n',
      });
      const actor = yield* born();
      const peer = yield* born();
      const record = Context.get(world.runtime.owners, ChangeRecord);
      const tools = createTools({
        cwd: root,
        world: machineWorld,
        changesOf: (caller) => record.changes({ work: { projectId, threadId: caller.thread!.threadId } }),
        commandTimes: unruledTimes,
        searchMs: 1000,
      });
      const path = join(root, 'created.txt');
      yield* call(tools.write!, actor.threadId, { path, content: 'created\n' });
      expect(yield* doors.atNative('submit_work', { subject: 'create the file' }, actor)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['created.txt'] } },
      });
      yield* staleMonitor(root);
      expect(yield* call(tools.delete!, actor.threadId, { args: [path] })).toMatchObject({ counts: { removed: 1 } });
      expect(yield* doors.atNative('submit_work', { subject: 'remove the file' }, actor)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['created.txt'] } },
      });
      expect(yield* tree(root)).toBe('base.txt\nedited.txt\nnamed.txt\npeer.txt\nremoved.txt\n');

      yield* staleMonitor(root, ['peer.txt']);
      expect(yield* call(tools.delete!, actor.threadId, { args: [join(root, 'removed.txt')] })).toMatchObject({ counts: { removed: 1 } });
      yield* call(tools.edit!, actor.threadId, { path: join(root, 'edited.txt'), oldString: 'before', newString: 'after' });
      const stale = yield* spawnedEffect(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: root });
      expect(new TextDecoder().decode(stale.stdout)).toBe('');
      yield* write(peer.threadId, 'peer.txt', 'peer landed\n');
      expect(yield* doors.atNative('submit_work', { subject: 'land the peer file' }, peer)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['peer.txt'] } },
      });
      const changes = yield* world.op('read_changes', { agent: actor.threadId, limit: 10 }, `project=${projectId}`);
      expect(changes.body).toMatchObject({
        held: { paths: 2 },
        turns: expect.arrayContaining([
          expect.objectContaining({ path: 'removed.txt', state: 'held' }),
          expect.objectContaining({ path: 'edited.txt', state: 'held' }),
        ]),
      });
      expect(yield* doors.atNative('submit_work', { subject: 'land the hidden changes' }, actor)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['edited.txt', 'removed.txt'] } },
      });
      expect(yield* tree(root)).toBe('base.txt\nedited.txt\nnamed.txt\npeer.txt\n');

      yield* staleMonitor(root);
      const outside = createTools({ cwd: root, world: machineWorld, commandTimes: unruledTimes, searchMs: 1000 });
      expect(yield* call(outside.delete!, 'external', { args: [join(root, 'named.txt')] })).toMatchObject({ counts: { removed: 1 } });
      const hidden = yield* spawnedEffect(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: root });
      expect(hidden.exitCode).toBe(0);
      expect(new TextDecoder().decode(hidden.stdout)).toBe('');
      expect(
        yield* world.op('submit_work', { paths: ['named.txt'], subject: 'remove the named file' }, `project=${projectId}`, {
          [MCP_SESSION_HEADER]: 'claude-code:outside',
        }),
      ).toMatchObject({ body: { submitted: { status: 'landed', committed: ['named.txt'] } } });
      expect(yield* tree(root)).toBe('base.txt\nedited.txt\npeer.txt\n');
    }).pipe(Effect.provide(BunFileSystem.layer)),
  60_000,
);
