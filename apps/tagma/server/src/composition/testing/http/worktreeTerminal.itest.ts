import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import type { WorktreeIntent } from '../../../worktrees/contract/wire/creation.js';
import type { TerminalOperationReading, TerminalWaited } from '../../../executions/contract/wire/operationAnswers.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

layer(Layer.merge(doorFixture(), BunFileSystem.layer), {
  excludeTestServices: true,
  testTimeout: 60_000,
  timeout: 60_000,
})('worktree beneath a terminal', (it) => {
  it.effect('delete_worktree removes a worktree beneath the folder a terminal stands in, and leaves that terminal running', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('project'));
      const projectId = yield* world.stealthProject(root);
      yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'born');
      yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
      const op = (id: string, input: unknown) => world.op(id, input, `project=${projectId}`);
      const repository = ((yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer).repositories[0]!;
      const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'side');
      yield* op('prepare_worktree', {
        operationId: 'beneath',
        repository: repository.binding,
        destination,
        mode: { kind: 'new-branch', branch: 'side', start: 'HEAD' },
      });
      const made = (yield* op('create_worktree', { operationId: 'beneath' })).body as { operation: WorktreeIntent };
      const started = (yield* op('start_terminal', {
        operationId: 'above-the-worktree',
        cwd: dirname(destination),
        label: 'sign-in',
        program: '/bin/sh',
        transport: 'pty',
        lifetime: 'held',
        geometry: { rows: 24, columns: 80 },
      })).body as typeof TerminalOperationReading.Type;
      const state = started.operation._tag === 'Whole' ? started.operation.state : null;
      const execution = state?._tag === 'Settled' ? state.execution : undefined;
      if (execution === undefined) return yield* Effect.die(new Error('the terminal did not start'));
      const address = { execution: execution.execution, incarnation: execution.incarnation };
      yield* Effect.addFinalizer(() =>
        Effect.orDie(op('stop_terminal', { ...address, operationId: 'above-the-worktree-stop', cause: 'explicit-stop' })),
      );

      expect(yield* op('delete_worktree', { rootId: made.operation.rootId })).toMatchObject({
        status: 200,
        body: { status: 'deleted', ended: [] },
      });
      expect(yield* files.exists(destination)).toBe(false);
      const waited = (yield* op('wait_terminal', { ...address, waitMs: 200 })).body as typeof TerminalWaited.Type;
      expect(waited.waited._tag).toBe('Undecided');
    }),
  );
});
