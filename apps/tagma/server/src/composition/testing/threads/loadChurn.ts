import { watch } from 'node:fs';
import { join } from 'node:path';
import { Context, Data, Effect, FileSystem, Queue } from 'effect';
import type { RpcClient, RpcClientError, RpcGroup } from 'effect/rpc';
import type { LiveGroup } from '../../rpc.js';
import type { DoorFixture } from '../doorFixture.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { ThreadHarness, NativeStorage } from '../../../threads/contract/service/engine.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { ThreadLookup } from '../../../threads/contract/service/reads.js';
import { settledThread } from '../native-harness/settled.fixture.js';
import { SERVER_SRC } from '../repoRoot.js';
import { suiteGit, suiteGitText } from '../suiteGit.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';

type LiveClient = RpcClient.RpcClient<RpcGroup.Rpcs<LiveGroup>, RpcClientError.RpcClientError>;
class ChurnRefused extends Data.TaggedError('ChurnRefused')<{ readonly message: string }> {}
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

export const loadChurn = Effect.fn('loadChurn')(function* (
  world: DoorFixture['Service'],
  client: LiveClient,
  projectId: number,
  checkout: string,
  installation: string,
) {
  const files = yield* FileSystem.FileSystem;
  const runner = join(installation, WORLD_COMMAND);
  const original = yield* files.readFileString(runner);
  const report = join(installation, 'churn-agent');
  const agent = join(SERVER_SRC, 'external-harnesses', 'testing', 'acpAgent.ts');
  const harness = Context.get(world.runtime.owners, ThreadHarness);
  const turns = turnsOf(world.runtime.owners);
  const threadId = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' })).thread
    .id;
  yield* Effect.addFinalizer(() => {
    const handle = harness.threads.handle(threadId, 'operator');
    return Effect.andThen(handle.stop(), handle.release()).pipe(Effect.orDie);
  });
  const seeded = yield* Effect.acquireUseRelease(
    files.writeFileString(runner, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(agent)} --report ${quote(report)} --mode tagma\n`, {
      mode: 0o755,
    }),
    () =>
      Effect.gen(function* () {
        const first = yield* turns.send(threadId, projectId, 'Fixture first turn.');
        const firstState = yield* settledThread({ threadId, projectId, runId: first.runId }).pipe(Effect.provide(world.runtime.owners));
        if (firstState.latestRun?.status !== 'completed') return yield* new ChurnRefused({ message: 'first fixture run did not complete' });
        const second = yield* turns.send(threadId, projectId, 'Fixture second turn.');
        const secondState = yield* settledThread({ threadId, projectId, runId: second.runId }).pipe(Effect.provide(world.runtime.owners));
        if (secondState.latestRun?.status !== 'completed')
          return yield* new ChurnRefused({ message: 'second fixture run did not complete' });
        return second.runId;
      }),
    () => files.writeFileString(runner, original, { mode: 0o755 }).pipe(Effect.orDie),
  );
  const identity = Effect.fnUntraced(function* () {
    const facet = (yield* Context.get(world.runtime.owners, ThreadLookup).find(threadId, 'operator'))?.harness;
    if (facet?.execution == null || facet.session === undefined || facet.session.state !== 'running')
      return yield* new ChurnRefused({ message: 'the auxiliary ACP execution is not running' });
    return { execution: facet.execution.execution, incarnation: facet.execution.incarnation, sessionId: facet.session.id };
  });
  const originalIdentity = yield* identity();
  const sameIdentity = Effect.fnUntraced(function* () {
    const current = yield* identity();
    if (
      current.execution !== originalIdentity.execution ||
      current.incarnation !== originalIdentity.incarnation ||
      current.sessionId !== originalIdentity.sessionId
    )
      return yield* new ChurnRefused({ message: 'the auxiliary ACP execution or session changed' });
  });
  const mark = Effect.fnUntraced(function* (runId: string) {
    const rows = yield* Context.get(world.runtime.owners, NativeStorage).threads.entriesOfRun(threadId, runId);
    if (rows.length === 0) return yield* new ChurnRefused({ message: 'the fixture run has no transcript entries' });
    return rows;
  });
  const op = Effect.fnUntraced(function* (id: string, input: object) {
    const answer = yield* world.op(id, input, `project=${projectId}`);
    if (answer.status !== 200) return yield* new ChurnRefused({ message: `${id} refused: ${JSON.stringify(answer.body)}` });
    return answer.body as { readonly status?: string; readonly rewindId?: string; readonly runIds?: readonly string[] };
  });
  const run = Effect.fn('loadChurn.run')(function* () {
    const before = yield* mark(seeded);
    yield* sameIdentity();
    const rewind = yield* op('rewind_thread', { threadId, at: seeded, scope: 'from' });
    yield* sameIdentity();
    if (rewind.status !== 'rewound' || rewind.rewindId === undefined || !rewind.runIds?.includes(seeded))
      return yield* new ChurnRefused({ message: 'rewind did not take the fixture run' });
    const after = yield* mark(seeded);
    if (!after.some((entry) => entry.rewound?.by === rewind.rewindId))
      return yield* new ChurnRefused({ message: 'rewind left no marked fixture entry' });
    yield* sameIdentity();
    const restore = yield* op('restore_thread', { threadId, rewindId: rewind.rewindId });
    yield* sameIdentity();
    if (restore.status !== 'restored' || !restore.runIds?.includes(seeded))
      return yield* new ChurnRefused({ message: 'restore did not return the fixture run' });
    const restored = yield* mark(seeded);
    if (
      restored.some((entry) => entry.rewound?.by === rewind.rewindId) ||
      !before.every((entry) => restored.some((row) => row.id === entry.id))
    )
      return yield* new ChurnRefused({ message: 'restore did not return the fixture entries' });
    yield* sameIdentity();
    const compact = yield* client['thread.compact']({ projectId, threadId, params: { at: 'end' } });
    yield* sameIdentity();
    if (compact.status !== 'started') return yield* new ChurnRefused({ message: `compaction answered ${compact.status}` });
    const finished = yield* settledThread({ threadId, projectId, runId: compact.runId }).pipe(Effect.provide(world.runtime.owners));
    yield* sameIdentity();
    if (
      finished.latestRun?.status !== 'completed' ||
      !finished.transcript.some(
        (entry) => entry.type === 'compaction' && entry.runId === compact.runId && 'status' in entry && entry.status === 'completed',
      )
    )
      return yield* new ChurnRefused({ message: 'the fixture compaction did not complete' });
    const commit = yield* overlap(checkout, installation);
    return {
      threadId,
      rewindId: rewind.rewindId,
      runId: seeded,
      compactionRunId: compact.runId,
      markedEntries: after.filter((entry) => entry.rewound?.by === rewind.rewindId).length,
      commit,
    };
  });
  return { threadId, run };
});

const overlap = Effect.fn('loadChurn.overlap')(function* (checkout: string, installation: string) {
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ directory: installation, prefix: 'churn-commit-' });
  const hookDir = join(directory, 'hooks');
  const entered = join(directory, 'entered');
  const release = join(directory, 'release');
  const relative = 'src/churn-external.txt';
  const target = join(checkout, relative);
  yield* files.makeDirectory(hookDir);
  yield* files.writeFileString(target, 'committed fixture\n');
  yield* suiteGit(checkout, 'add', '--', relative);
  const hook = join(import.meta.dir, 'loadChurnHook.ts');
  yield* files.writeFileString(
    join(hookDir, 'pre-commit'),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(hook)} ${quote(directory)}\n`,
    { mode: 0o755 },
  );
  const signal = yield* Effect.acquireRelease(Queue.sliding<void>(1), Queue.shutdown);
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      watch(directory, () => {
        Queue.offerUnsafe(signal, undefined);
      }),
    ),
    (watcher) => Effect.sync(() => watcher.close()),
  );
  const commit = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn(
          [
            'git',
            '-c',
            'user.name=suite',
            '-c',
            'user.email=suite@tagma',
            '-c',
            `core.hooksPath=${hookDir}`,
            'commit',
            '-qm',
            'churn fixture',
          ],
          { cwd: checkout, stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' },
        ),
      catch: (cause) => new ChurnRefused({ message: `commit could not start: ${String(cause)}` }),
    }),
    (child) =>
      Effect.andThen(
        files.writeFileString(release, 'release\n').pipe(Effect.orDie),
        Effect.promise(() => child.exited),
      ),
  );
  const waiting = Effect.gen(function* () {
    while (!(yield* files.exists(entered))) yield* Queue.take(signal);
  });
  yield* Effect.raceFirst(
    waiting,
    Effect.flatMap(
      Effect.promise(() => commit.exited),
      (code) => new ChurnRefused({ message: `commit ended before the hook barrier: ${code}` }),
    ),
  );
  const external = yield* spawnedEffect(['/bin/sh', '-c', `printf 'external fixture\\n' > ${quote(target)}`]);
  if (!external.success) return yield* new ChurnRefused({ message: `external write failed: ${external.stderr.toString()}` });
  yield* files.writeFileString(release, 'release\n');
  const code = yield* Effect.promise(() => commit.exited);
  if (code !== 0) return yield* new ChurnRefused({ message: `fixture commit exited ${code}` });
  const head = yield* suiteGit(checkout, 'rev-parse', 'HEAD');
  const committed = yield* suiteGitText(checkout, 'show', `HEAD:${relative}`);
  const standing = yield* files.readFileString(target);
  if (committed !== 'committed fixture\n' || standing !== 'external fixture\n')
    return yield* new ChurnRefused({ message: 'the overlapping commit and external write did not preserve their respective bytes' });
  return { head, path: relative, externalPid: external.pid };
}, Effect.scoped);
