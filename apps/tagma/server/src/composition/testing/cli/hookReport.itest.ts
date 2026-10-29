import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ProjectLifecycle } from '../../../graph/contract/service/serving.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { makeTerminalWorld } from '../fixture.js';
import { born, HOOK_SESSION, hookThreads, running } from '../hookFixture.js';

const setup = Effect.gen(function* () {
  const world = yield* makeTerminalWorld();
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory(join('private', 'hook-report')));
  const project = yield* Context.get(world.runtime.graph, ProjectLifecycle)
    .create({ name: 'private', rootPath: root, private: true })
    .pipe(Effect.provide(world.runtime.owners));
  yield* world.warm(project.id);
  return { world, project: { id: project.id, root }, threads: hookThreads(world) };
});

class Reports extends Context.Service<Reports, Effect.Success<typeof setup>>()('testing/HookReports') {}

layer(Layer.effect(Reports, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('hook reports', (it) => {
  it.effect('the granted CLI binds its server facet and receives a private checkout law without truncation', () =>
    Effect.gen(function* () {
      const { world, project, threads } = yield* Reports;
      const threadId = yield* threads.bornThread(crypto.randomUUID(), project.id, yield* running(born('devin', 'root')));
      const served = yield* world.runtime.pool.resolve({ projectId: project.id }).pipe(Effect.provide(world.runtime.owners));
      const law = 'law-body-7f3a '.repeat(1_000);
      const blocks = Context.get(served.context, Blocks);
      yield* blocks
        .create({
          projectId: project.id,
          parentId: (yield* blocks.rootBlockOf(project.id).pipe(Effect.provide(served.context))).id,
          tags: ['rule'],
          title: 'A long law',
          body: law,
        })
        .pipe(Effect.provide(served.context));
      const unsigned = yield* Effect.promise(() =>
        fetch(`${world.url}/api/op/report_harness_event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionKey: 'ungranted' }),
        }),
      );
      expect(unsigned.ok).toBe(false);
      expect(yield* Effect.promise(() => unsigned.json())).toMatchObject({ code: 'thread-required' });
      const answer = yield* threads.hook(
        'session-start',
        project.root,
        {
          hook_event_name: 'SessionStart',
          source: 'startup',
          session_id: 'root',
        },
        threadId,
      );
      expect(JSON.parse(answer.out).hookSpecificOutput.additionalContext).toContain(law.trim());
      const facet = yield* threads.facetOf(threadId);
      expect(facet?.sessionKey).toBe('root');
      expect(facet?.observation.binding).toMatchObject({ sessionId: HOOK_SESSION, rootKey: 'root' });
      expect(facet?.observation.metadata.model).toMatchObject({ _tag: 'Unsupported', source: 'hook' });
      expect(yield* threads.workOf(threadId)).toBe('idle');
      expect(yield* (yield* FileSystem.FileSystem).exists(join(project.root, 'AGENTS.md'))).toBe(false);
    }),
  );
});
