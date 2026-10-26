import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { RepositoryBinding } from '../../../workspace/contract/wire/repositories.js';
import type { WorktreeIntent } from '../../../worktrees/contract/wire/creation.js';
import { makeTerminalWorld } from '../fixture.js';
import { suiteGit } from '../suiteGit.js';

type Stored = { readonly repositories: readonly { binding: RepositoryBinding }[] };

const setup = Effect.gen(function* () {
  const world = yield* makeTerminalWorld();
  const files = yield* FileSystem.FileSystem;
  const store = yield* world.checkout();
  yield* suiteGit(store.root, 'init', '-q', '-b', 'main');
  yield* suiteGit(store.root, 'commit', '-q', '--allow-empty', '-m', 'born');
  const home = yield* files.realPath(yield* world.directory('checkouts-of-the-store'));
  yield* Context.get(world.runtime.workspace, Coverage).cover(store.id);
  const op = (id: string, input: unknown, project = store.name) =>
    world.tagma(['op', id, '--json', '--project', project, JSON.stringify(input)]);
  const listed = yield* op('read_repositories', {});
  const repository = (JSON.parse(listed.out) as Stored).repositories[0]?.binding as RepositoryBinding;
  const prepare = (operationId: string, destination: string, binding = repository, project = store.name) =>
    op(
      'prepare_worktree',
      {
        operationId,
        destination,
        repository: binding,
        mode: { kind: 'new-branch', branch: operationId, start: 'HEAD' },
      },
      project,
    );
  return { world, store, repository, home, op, prepare };
});

class Terminal extends Context.Service<Terminal, Effect.Success<typeof setup>>()('testing/CliWorktree') {}

layer(Layer.effect(Terminal, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('cli worktree', (it) => {
  it.effect('an operator prepares, creates and reads one worktree by its operation id', () =>
    Effect.gen(function* () {
      const { home, op, prepare } = yield* Terminal;
      const destination = join(home, 'from-a-terminal');
      const prepared = yield* prepare('terminal-made', destination);
      expect(prepared.code).toBe(0);
      expect(JSON.parse(prepared.out)).toMatchObject({ operation: { status: 'pending', destination } });

      const made = yield* op('create_worktree', { operationId: 'terminal-made' });
      expect(made.code).toBe(0);
      expect(JSON.parse(made.out)).toMatchObject({ status: 'ok', operation: { status: 'ready', destination } });

      const read = yield* op('read_worktree_operation', { operationId: 'terminal-made' });
      const record = (JSON.parse(read.out) as { operation: WorktreeIntent }).operation;
      expect(record).toMatchObject({ operationId: 'terminal-made', status: 'ready', destination });
      expect(record.rootId).not.toBeNull();
    }),
  );

  it.effect('recovery carries its observed target whole into adopt_worktree', () =>
    Effect.gen(function* () {
      const { world, store, repository, op, prepare } = yield* Terminal;
      const files = yield* FileSystem.FileSystem;
      const hook = join(store.root, '.git', 'hooks', 'post-checkout');
      yield* files.makeDirectory(dirname(hook), { recursive: true });
      yield* Effect.acquireRelease(files.writeFileString(hook, '#!/bin/sh\necho "the hook refuses" >&2\nexit 1\n', { mode: 0o755 }), () =>
        Effect.orDie(files.remove(hook)),
      );
      const destination = join(yield* world.directory('unresolved'), 'taken-from-a-terminal');

      const prepared = yield* prepare('terminal-recovered', destination, repository, store.name);
      expect(prepared.code, prepared.out || prepared.err).toBe(0);
      const ran = yield* op('create_worktree', { operationId: 'terminal-recovered' }, store.name);
      expect((JSON.parse(ran.out) as { operation: WorktreeIntent }).operation.status).toBe('uncertain');

      const resolved = yield* op('prepare_worktree_recovery', { operationId: 'terminal-recovered', observed: destination }, store.name);
      const recovery = JSON.parse(resolved.out) as { observed: unknown; operation: WorktreeIntent };
      const taken = yield* op(
        'adopt_worktree',
        { operationId: 'terminal-recovered', revision: recovery.operation.revision, observed: recovery.observed },
        store.name,
      );
      expect(taken.code).toBe(0);
      expect(JSON.parse(taken.out)).toMatchObject({ status: 'ok', operation: { status: 'ready', rootId: expect.anything() } });

      const malformed = yield* op('adopt_worktree', { operationId: 'terminal-recovered', revision: 1, observed: destination }, store.name);
      expect(malformed.code).toBe(2);
      expect(JSON.parse(malformed.out)).toMatchObject({ code: 'body-shape' });
    }),
  );
});
