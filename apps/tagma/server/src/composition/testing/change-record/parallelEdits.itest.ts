import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Deferred, Effect, Fiber } from 'effect';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import type { WorkspaceChanges } from '@runlith/agent-tools/WorkspaceChanges';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { Git } from '@runlith/git/Git';
import { callerInThread } from '../callers.js';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { changeRecordOf, intakeOf } from '../../../change-record/testing/doubles.js';
import { checkoutPaths, fixedCoverage } from '../../../workspace/testing/doubles.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

const THREAD = 'parallel-editor';
const NAMES = ['alpha.itest.ts', 'beta.itest.ts', 'gamma.itest.ts'];

const called = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const call = { toolCallId: crypto.randomUUID(), caller: callerInThread(THREAD, 'run') };
  const prepare = toolPrepare(tool);
  const prepared = prepare === null ? null : (yield* prepare(input, call)).prepared;
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die('the tool has no execution');
  return yield* Effect.match(execute(input, { ...call, prepared, messages: [] }), {
    onFailure: (failure) => `failed: ${failure.message}`,
    onSuccess: (answer) => (answer instanceof ToolAnswer ? String(answer.value) : String(answer)),
  });
});

layer(demoGraphLayer({ repos: ['home'] }), { excludeTestServices: true })('parallel edits', (it) => {
  it.effect('edits of other files in one directory land while an edit there is still landing', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const home = demo.project('home');
        const root = realpathSync(home.root);
        const coverage = fixedCoverage(home.id, [{ checkout: 'home', root }]);
        const paths = yield* checkoutPaths(coverage, demo.graph.projects).pipe(Effect.provide(demo.context));
        const { store, units } = demo.graph;
        yield* bornThread(
          store.db,
          {
            id: THREAD,
            ownerId: 'owner',
            agentId: 'tagma',
            spawnRootId: THREAD,
            cacheGroup: THREAD,
            status: 'idle',
            provider: 'openai-oauth',
            model: 'gpt-test',
            reasoning: 'high',
            authority: { mode: 'trust', bypassFrom: null },
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
          { projectId: home.id, title: 'Editor', readerOrderAt: new Date(0) },
        ).pipe(Effect.provide(demo.context));
        const intake = yield* intakeOf(store, units, yield* Git, paths);
        const record = yield* changeRecordOf(store, units, paths, intake);
        const port = record.changes({ work: { projectId: home.id, threadId: THREAD } });
        const directory = join(root, 'testing', 'http');
        mkdirSync(directory, { recursive: true });
        for (const name of NAMES) writeFileSync(join(directory, name), '  timeout: 60_000,\n');
        const landing = yield* Deferred.make<void>();
        const others = yield* Deferred.make<void>();
        const gated: WorkspaceChanges = {
          ...port,
          land: (batch, write) =>
            Effect.andThen(
              batch[0]?.path.endsWith(NAMES[0]!)
                ? Effect.andThen(Deferred.succeed(landing, undefined), Deferred.await(others))
                : Effect.void,
              port.land(batch, write),
            ),
        };
        const tools = createTools({
          cwd: root,
          world: makeMachineWorld(() => null),
          changes: gated,
          commandTimes: unruledTimes,
          searchMs: LONGEST_ACT_MS,
        });
        const edited = (name: string) =>
          called(tools.edit as Tool, { path: join(directory, name), oldString: '  timeout: 60_000,\n', newString: '' });

        const first = yield* Effect.forkChild(edited(NAMES[0]!));
        yield* Deferred.await(landing);
        const rest = yield* Effect.forEach(NAMES.slice(1), edited, { concurrency: 'unbounded' });
        yield* Deferred.succeed(others, undefined);
        const said = [yield* Fiber.join(first), ...rest];

        expect(said.map((answer) => answer.startsWith('Edit applied successfully.'))).toEqual([true, true, true]);
        expect(NAMES.map((name) => readFileSync(join(directory, name), 'utf8'))).toEqual(['', '', '']);
      }).pipe(Effect.provide(BunFileSystem.layer)),
    ),
  );
});
