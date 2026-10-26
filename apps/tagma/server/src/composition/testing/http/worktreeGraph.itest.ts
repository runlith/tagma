import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Context, Deferred, Effect, FileSystem, Layer, Stream } from 'effect';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { suiteGit } from '../suiteGit.js';
import { turnsOf } from '../../../threads/testing/doubles.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { makeDoorWorld } from '../doorFixture.js';
import { holdThreads } from '../threadScope.js';

const ASK = 'Check the claim over the file only this worktree holds.';

const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});

const call = (id: string, name: string, input: unknown): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id, name },
  { type: 'tool-call', id, name, input },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];

const answer = (id: string, text: string): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id },
  { type: 'text-delta', id, text },
  { type: 'text-end', id },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];

type Script = { readonly told: string[]; claim: string; readonly done: Deferred.Deferred<void> };

const scripted =
  (script: Script) =>
  (standing: ModelAccess['Service']): ModelAccess['Service'] => ({
    ...standing,
    request: (selection: ModelRequestInput) =>
      ({
        system: selection.instructions,
        origin: new ModelIdentity({
          provider: ProviderID.make(selection.provider ?? 'scripted'),
          model: ModelID.make(selection.model ?? 'scripted'),
        }),
        plannedOutputTokens: 32,
        text: () => Effect.die(new Error('the scripted model answers streamed requests only')),
        object: () => Effect.die(new Error('the scripted model answers streamed requests only')),
        stream: (input: ModelStreamInput) =>
          Stream.suspend(() => {
            const said = JSON.stringify(input.messages);
            if (!said.includes(ASK) || said.includes('NO-TOPIC')) return Stream.fromIterable(answer('other', 'Nothing to do.'));
            if (said.includes('"type":"tool-result","id":"check"')) {
              Deferred.doneUnsafe(script.done, Effect.void);
              return Stream.fromIterable(answer('done', 'Checked.'));
            }
            script.told.push(said);
            return Stream.fromIterable(
              call('check', 'edit_block', { blockId: script.claim, oldString: 'unchecked', newString: 'checked' }),
            );
          }),
      }) as ReturnType<ModelAccess['Service']['request']>,
  });

const setup = Effect.gen(function* () {
  const script: Script = { told: [], claim: '', done: Deferred.makeUnsafe<void>() };
  const world = yield* makeDoorWorld({ models: scripted(script) });
  yield* holdThreads(world);
  const files = yield* FileSystem.FileSystem;
  const checkout = yield* files.realPath(yield* world.directory('copies'));
  yield* suiteGit(checkout, 'init', '-q', '-b', 'main');
  yield* suiteGit(checkout, 'commit', '-q', '--allow-empty', '-m', 'born');
  const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: checkout, storage: 'stealth' });
  if (added.status !== 200) return yield* Effect.die(new Error(`the project was not added: ${JSON.stringify(added.body)}`));
  return { world, script, project: (added.body as { project: { id: number } }).project.id };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/WorktreeGraph') {}

const named = Effect.fnUntraced(function* (input: unknown, cwd?: string) {
  const { world, project } = yield* Place;
  const written = yield* world.op('create_block', input, `project=${project}${cwd === undefined ? '' : `&cwd=${encodeURIComponent(cwd)}`}`);
  if (written.status !== 200) return yield* Effect.die(new Error(`the block was not written: ${JSON.stringify(written.body)}`));
  expect(written.body).toMatchObject({ graphCopy: { projectId: project, branch: cwd === undefined ? null : 'placed' } });
  return (written.body as { block: { name: string } }).block.name;
});

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('worktree graph', (it) => {
  it.effect(
    'a thread placed in a worktree is told the law of that worktree’s graph copy and verifies its claims against that worktree’s files',
    () =>
      Effect.gen(function* () {
        const { world, script, project } = yield* Place;
        const files = yield* FileSystem.FileSystem;
        yield* Context.get(world.runtime.workspace, Coverage).cover(project);
        const listed = (yield* world.op('read_repositories', {}, `project=${project}`)).body as CoveredRepositoriesAnswer;
        const repository = listed.repositories[0]?.binding;
        if (repository === undefined) return yield* Effect.die(new Error(`project ${project} covers no store`));
        const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'placed');
        const prepared = yield* world.op(
          'prepare_worktree',
          { operationId: 'placed', repository, destination, mode: { kind: 'new-branch', branch: 'placed', start: 'HEAD' } },
          `project=${project}`,
        );
        expect(prepared.status).toBe(200);
        const created = yield* world.op('create_worktree', { operationId: 'placed' }, `project=${project}`);
        expect(created.body).toMatchObject({ status: 'ok' });
        yield* files.writeFileString(join(destination, 'only-here.ts'), 'export const here = 1;\n');
        const worktreeLaw = yield* named({ tags: ['rule'], title: 'Law the worktree copy holds' }, destination);
        script.claim = yield* named(
          {
            tags: ['idea'],
            title: 'Over a file only the worktree holds',
            body: 'unchecked',
            sources: [{ kind: 'file', ref: 'only-here.ts' }],
          },
          destination,
        );
        const mainLaw = yield* named({ tags: ['rule'], title: 'Law the main copy holds' });
        const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
        const thread = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
        const rootId = (created.body as { operation: { rootId: string } }).operation.rootId;
        expect((yield* world.op('move_thread', { threadId: thread, worktree: rootId }, `project=${project}`)).body).toMatchObject({
          status: 'selected',
        });
        yield* turnsOf(world.runtime.owners).send(thread, project, ASK);
        yield* Deferred.await(script.done);
        expect(script.told[0]).toContain(worktreeLaw);
        expect(script.told[0]).not.toContain(mainLaw);
        const read = yield* world.op(
          'read_block',
          { blockIds: [script.claim] },
          `project=${project}&cwd=${encodeURIComponent(destination)}`,
        );
        expect((read.body as { reads: readonly { body: string }[] }).reads[0]?.body).toBe('checked');
      }),
  );
});
