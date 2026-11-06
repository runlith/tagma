import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, Fiber, FileSystem } from 'effect';
import { THREAD_TOOL_CONFIRM_VALUE } from '@runlith/agent/transcript/parts';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import type { WorktreeIntent } from '../../../worktrees/contract/wire/creation.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { suiteGit } from '../suiteGit.js';
import { until } from './protocolRig.js';
import { heldTurn, textOf } from './hostedTurn.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const worktree = Effect.fnUntraced(function* (name: string) {
  const { world, projectId, checkout } = yield* ProtocolWorld;
  const files = yield* FileSystem.FileSystem;
  yield* suiteGit(checkout, 'commit', '-q', '--allow-empty', '-m', name);
  yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  const op = (id: string, input: unknown) => world.op(id, input, `project=${projectId}`);
  const repository = ((yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer).repositories[0]!;
  const destination = join(yield* files.realPath(yield* world.directory(`${name}-trees`)), name);
  yield* op('prepare_worktree', {
    operationId: name,
    repository: repository.binding,
    destination,
    mode: { kind: 'new-branch', branch: name, start: 'HEAD' },
  });
  const made = (yield* op('create_worktree', { operationId: name })).body as { operation: WorktreeIntent };
  return { rootId: made.operation.rootId, destination };
});

describe('a Tagma agent on ACP moves between worktrees like a native one', () => {
  layer(protocolWorld({ name: 'hosted-move', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('protocol world', (it) => {
    it.effect('a Claude Code thread moves itself in the middle of a turn, and its next command runs in the worktree', () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const side = yield* worktree('side');
        const { threadId, called, release } = yield* heldTurn('mover', 'bypass');
        yield* called('reveal', 'tool_search', { query: 'select:move_thread' });
        const moved = yield* called('move', 'move_thread', { threadId, worktree: side.rootId });
        expect({ failed: moved.failed, said: textOf(moved) }).toMatchObject({ failed: false });
        const printed = yield* called('print', 'bash', { command: 'pwd', description: 'Print the working directory' });
        expect(textOf(printed)).toContain(side.destination);
        yield* release;
      }),
    );

    it.effect('a move that lands while a call waits for its approval takes effect after that call, which finishes where it was asked', () =>
      Effect.gen(function* () {
        const { world, projectId, checkout, changes } = yield* ProtocolWorld;
        const files = yield* FileSystem.FileSystem;
        const aside = yield* worktree('aside');
        yield* files.writeFileString(join(aside.destination, 'aside-marker'), 'the worktree\n');
        const { threadId, report, called, release } = yield* heldTurn('approver', 'review');
        const harness = Context.get(world.runtime.owners, ThreadHarness);
        const writing = yield* Effect.forkScoped(called('write', 'write', { path: 'asked.txt', content: 'written where it was asked\n' }));
        const question = yield* until(
          Effect.map(harness.runs.questions().open(threadId), (open) => open[0] ?? null),
          'the write asked the operator',
          report,
          changes(threadId),
        );
        expect((yield* world.op('move_thread', { threadId, worktree: aside.rootId }, `project=${projectId}`)).body).toMatchObject({
          status: 'pending',
        });
        expect(textOf(yield* called('look', 'ls', { path: '.' }))).not.toContain('aside-marker');
        yield* harness.runs.hosting().answer(threadId, question.questionId, [{ questionId: 'write', values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        expect((yield* Fiber.join(writing)).failed).toBe(false);
        expect(yield* files.readFileString(join(checkout, 'asked.txt'))).toBe('written where it was asked\n');
        expect(textOf(yield* called('look-again', 'ls', { path: '.' }))).toContain('aside-marker');
        yield* release;
      }),
    );
  });

  layer(protocolWorld({ name: 'hosted-detached', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('detached checkout', (it) => {
    it.effect('a hosted tool after moving to a detached team checkout reads inherited law and keeps the graph read-only', () =>
      Effect.gen(function* () {
        const { world, projectId, checkout } = yield* ProtocolWorld;
        expect((yield* world.op('set_project_storage', { ref: String(projectId), mode: 'team' })).status).toBe(200);
        expect((yield* world.op('sync_graph', {}, `project=${projectId}`)).status).toBe(200);
        const roots = yield* world.op('list_root_blocks', {}, `project=${projectId}`);
        const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
        const history = yield* worktree('history');
        yield* suiteGit(history.destination, 'checkout', '--detach', 'HEAD');
        const tip = yield* suiteGit(history.destination, 'rev-parse', 'HEAD');
        const { threadId, called, release } = yield* heldTurn('historian', 'bypass');
        yield* called('reveal', 'tool_search', { query: 'select:move_thread,create_block' });
        const moved = yield* called('move', 'move_thread', { threadId, worktree: history.rootId });
        expect({ failed: moved.failed, said: textOf(moved) }).toMatchObject({ failed: false });
        const listed = yield* called('look', 'ls', { path: history.destination, limit: 5 });
        expect({ failed: listed.failed, said: textOf(listed) }).toMatchObject({ failed: false });
        expect(textOf(listed)).toContain('.tagma/');
        const written = yield* called('write', 'create_block', { parentId, title: 'Cannot change a historical graph' });
        expect(written.failed).toBe(true);
        expect(textOf(written)).toContain('detached-checkout');
        expect(yield* suiteGit(history.destination, 'status', '--porcelain')).toBe('');
        expect(yield* suiteGit(history.destination, 'rev-parse', 'HEAD')).toBe(tip);
        expect(yield* suiteGit(checkout, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
        yield* release;
      }),
    );
  });
});
