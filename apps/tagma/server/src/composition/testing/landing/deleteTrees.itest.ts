import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem } from 'effect';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { callerInThread } from '../callers.js';
import { nativeLanding } from './native.js';

const call = Effect.fnUntraced(function* (tool: Tool, thread: string, input: unknown) {
  const invocation = { toolCallId: crypto.randomUUID(), caller: callerInThread(thread, 'run'), messages: [] };
  const prepared = yield* toolPrepare(tool)!(input, invocation);
  const answer = yield* toolExecute(tool)!(input, { ...invocation, prepared: prepared.prepared });
  tool.settled?.(invocation);
  return answer instanceof ToolAnswer ? answer.value : answer;
});

const listening = (path: string) =>
  Effect.acquireRelease(
    Effect.callback<ReturnType<typeof createServer>>((resume) => {
      const server = createServer();
      server.listen(path, () => resume(Effect.succeed(server)));
    }),
    (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void))),
  );

it.live('a thread deletes sockets outside every checkout, records its tracked deletions and leaves ignored ones unrecorded', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const { world, born, root, projectId } = yield* nativeLanding({ '.gitignore': 'built/\n', 'kept/a.txt': 'a\n', 'kept/b.txt': 'b\n' });
    const actor = yield* born();
    const record = Context.get(world.runtime.owners, ChangeRecord);
    const tools = createTools({
      cwd: root,
      world: machineWorld,
      changesOf: (caller) => record.changes({ work: { projectId, threadId: caller.thread!.threadId } }),
      commandTimes: unruledTimes,
      searchMs: 1000,
      allowOutsideCwd: true,
    });
    const outside = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'delete-trees-' }));
    yield* files.makeDirectory(join(outside, 'tree/executions'), { recursive: true });
    yield* listening(join(outside, 'tree/executions/host.sock'));
    yield* listening(join(outside, 'lone.sock'));
    yield* files.writeFileString(join(outside, 'tree/note.txt'), 'note\n');
    expect(
      yield* call(tools.delete!, actor.threadId, { args: ['-rf', '--', join(outside, 'tree'), join(outside, 'lone.sock')] }),
    ).toMatchObject({
      status: 'completed',
      counts: { removed: 5, failed: 0 },
    });
    expect(yield* files.readDirectory(outside)).toEqual([]);

    yield* files.makeDirectory(join(root, 'built/deep'), { recursive: true });
    yield* files.writeFileString(join(root, 'built/deep/out.js'), 'out\n');
    expect(yield* call(tools.delete!, actor.threadId, { args: ['-rf', '--', join(root, 'built'), join(root, 'kept')] })).toMatchObject({
      status: 'completed',
      counts: { removed: 6, failed: 0 },
    });
    const changes = yield* world.op('read_changes', { agent: actor.threadId, limit: 20 }, `project=${projectId}`);
    const held = JSON.stringify(changes.body);
    expect(held).toContain('kept/a.txt');
    expect(held).toContain('kept/b.txt');
    expect(held).not.toContain('built/');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
