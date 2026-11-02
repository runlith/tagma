import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Path } from 'effect';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { NamespaceId } from '@runlith/files/namespace';
import { Git } from '@runlith/git/Git';
import { demoGraphLayer, gitEffect, withDemo } from '../graphFixture.js';
import { call } from '../checkoutFixture.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { servedOver } from '../../../change-record/testing/doubles.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { checkoutPaths, coveredWorkspace, gitCheckoutRows } from '../../../workspace/testing/doubles.js';

const ACTOR = 'writer-a';

layer(demoGraphLayer({ repos: ['source', 'target'] }), { excludeTestServices: true })('commands across checkouts', (it) => {
  it.effect('a command’s lines in another registered checkout are its thread’s, named through an alias, a link or a pattern', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { store, units, projects } = demo.graph;
        const git = yield* Git;
        const files = yield* FileSystem.FileSystem;
        const source = realpathSync(demo.project('source').root);
        const target = realpathSync(demo.project('target').root);
        const outside = yield* files.makeTempDirectoryScoped({ prefix: 'cross-commands-' });
        yield* files.writeFileString(join(source, 'template.txt'), 'made\n');
        yield* files.writeFileString(join(outside, 'pointed.txt'), 'pointed\n');
        yield* files.writeFileString(join(target, 'doomed.txt'), 'doomed\n');
        yield* files.symlink(join(outside, 'pointed.txt'), join(target, 'link'));
        yield* files.symlink(target, join(outside, 'alias'));
        yield* gitEffect(target, ['add', 'doomed.txt', 'link']);
        yield* gitEffect(target, ['commit', '-q', '-m', 'doomed and a link']);
        yield* bornThread(
          store.db,
          {
            id: ACTOR,
            ownerId: 'owner',
            agentId: 'tagma',
            spawnRootId: ACTOR,
            cacheGroup: ACTOR,
            name: 'writer',
            status: 'idle',
            provider: 'openai-oauth',
            model: 'gpt-test',
            reasoning: 'high',
            authority: { mode: 'trust', bypassFrom: null },
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
          { projectId: demo.projectId, title: 'writer', readerOrderAt: new Date(0) },
        );
        const { roots, coverage } = yield* coveredWorkspace({ namespaceId: NamespaceId.make('cross-commands'), projects, git });
        const paths = yield* checkoutPaths(coverage, projects);
        const checkouts = yield* gitCheckoutRows(git, roots, files, yield* Effect.scope);
        const served = yield* servedOver({ store, units, git, checkouts, paths, roots, coverage });
        const tools = createTools({
          cwd: source,
          world: makeMachineWorld(() => null),
          commandTimes: unruledTimes,
          searchMs: LONGEST_ACT_MS,
          unowned: ['.tagma'],
          allowOutsideCwd: true,
          changes: served.changes.changes({ work: { projectId: demo.projectId, threadId: ACTOR } }),
        });

        yield* call(tools.bash, {
          command: `cp template.txt '${join(outside, 'alias', 'copied.txt')}'`,
          description: 'Copy through an alias',
        });
        yield* call(tools.bash, { command: `rm '${join(target, 'link')}'`, description: 'Remove a link' });
        const pattern = join(dirname(target), `${basename(target).slice(0, -1)}*`, 'doomed.txt');
        yield* call(tools.bash, { command: `rm ${pattern}`, description: 'Remove by a pattern above the checkout' });

        const held = yield* served.changes.held({ kind: 'thread', projectId: demo.projectId, threadId: ACTOR });
        expect(held.map((one) => [one.path, one.origin]).sort()).toEqual([
          ['copied.txt', 'write'],
          ['doomed.txt', 'delete'],
          ['link', 'delete'],
        ]);
      }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(Path.layer)),
    ),
  );
});
