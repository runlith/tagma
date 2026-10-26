import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import type { ModelStreamInput } from '@runlith/agent/modelPort';
import { ThreadContextChangeEntry } from '@runlith/agent/transcript/entries';
import { targetSourceKey } from '../../../threads/contract/wire/target.js';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { and, eq } from 'drizzle-orm';
import { Context, Deferred, Effect, FileSystem, Schedule, Schema, Stream } from 'effect';
import { threadEntry, birthsOf, turnsOf, movesOf } from '../../../threads/testing/doubles.js';
import { WORKTREE_ENTRY, WorktreeEntry } from '../../../worktrees/contract/wire/entries.js';
import { WorktreeRecords } from '../../../worktrees/contract/service/worktrees.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { gitEffect } from '../graphFixture.js';
import { projectLeaving } from '../doorFixture.js';

const fixture = doorFixture();
const MOVER_ASK = 'Print where you stand, twice.';
const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});
const call = (id: string, command: string): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id, name: 'bash' },
  { type: 'tool-call', id, name: 'bash', input: { command, description: 'Read the working directory' } },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];
const answer: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'done' },
  { type: 'text-delta', id: 'done', text: 'Printed.' },
  { type: 'text-end', id: 'done' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];
const resultOf = (input: ModelStreamInput, id: string) =>
  input.messages
    .flatMap((message) => message.content.flatMap((part) => (part.type === 'tool-result' && part.id === id ? [part.result] : [])))
    .at(-1);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
it.live(
  'a move waits for the running command boundary, then the next command uses the selected worktree',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const gates = yield* files.makeTempDirectoryScoped({ prefix: 'thread-move-' });
      const ready = join(gates, 'ready');
      const release = join(gates, 'release');
      const script = `const fs=require('node:fs');let done=false;const finish=()=>{if(done||!fs.existsSync(${JSON.stringify(release)}))return;done=true;watcher.close();console.log(process.cwd());};const watcher=fs.watch(${JSON.stringify(gates)},finish);fs.writeFileSync(${JSON.stringify(ready)},'ready');finish();`;
      const command = `${quote(process.execPath)} -e ${quote(script)}`;
      const seen: ModelStreamInput[] = [];
      const answered = yield* Deferred.make<void>();
      const world = yield* DoorFixture;
      yield* world.lend({
        models: (standing) => ({
          ...standing,
          request: (selection) => ({
            system: selection.instructions,
            origin: new ModelIdentity({
              provider: ProviderID.make(selection.provider ?? 'scripted'),
              model: ModelID.make(selection.model ?? 'scripted'),
            }),
            plannedOutputTokens: 32,
            text: () => Effect.die(new Error('the moving model streams only')),
            object: () => Effect.die(new Error('the moving model streams only')),
            stream: (input) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  if (!JSON.stringify(input.messages).includes(MOVER_ASK)) return Stream.fromIterable(answer);
                  seen.push(input);
                  if (resultOf(input, 'first-pwd') === undefined) return Stream.fromIterable(call('first-pwd', command));
                  if (resultOf(input, 'second-pwd') === undefined) return Stream.fromIterable(call('second-pwd', 'pwd'));
                  yield* Deferred.succeed(answered, undefined);
                  return Stream.fromIterable(answer);
                }),
              ),
          }),
        }),
      });
      const checkout = yield* world.directory('move-project');
      yield* gitEffect(checkout, ['init', '-q', '-b', 'main']);
      yield* files.writeFileString(join(checkout, 'seed'), 'the project\n');
      yield* gitEffect(checkout, ['add', '.']);
      yield* gitEffect(checkout, [
        '-c',
        'user.email=fixture@tagma',
        '-c',
        'user.name=fixture',
        'commit',
        '--no-gpg-sign',
        '-q',
        '-m',
        'first',
      ]);
      const projectId = yield* world.stealthProject(checkout);
      yield* projectLeaving(world, projectId);
      yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
      const births = birthsOf(world.runtime.owners);
      const turns = turnsOf(world.runtime.owners);
      const moves = movesOf(world.runtime.owners);
      const units = Context.get(world.runtime.graph, MachineUnits);
      const { db } = Context.get(world.runtime.graph, MachineStore);
      const opened = yield* births.create({ projectId, createdBySessionId: null, worktree: 'new', name: 'destination' });
      const trees = yield* units.read((unit) => Context.get(world.runtime.workspace, WorktreeRecords).records(projectId, unit));
      const destination = trees[0]!;
      const mover = yield* births.create({ projectId, createdBySessionId: null, approvalMode: 'bypass' });
      yield* turns.send(mover.thread.id, projectId, MOVER_ASK);
      yield* files
        .exists(ready)
        .pipe(
          Effect.repeat({ while: (started) => !started, schedule: Schedule.spaced(25) }),
          Effect.withSpan('testing.moveCommandStarted'),
        );
      expect((yield* moves.move(projectId, { kind: 'operator' }, { threadId: mover.thread.id, worktree: destination.name })).status).toBe(
        'pending',
      );
      yield* files.writeFileString(release, 'release');
      yield* Deferred.await(answered);
      const completed = seen.find((input) => resultOf(input, 'second-pwd') !== undefined);
      if (completed === undefined) return yield* Effect.die(new Error('the model never received its second command result'));
      expect(JSON.stringify(resultOf(completed, 'first-pwd'))).toContain(yield* files.realPath(checkout));
      expect(JSON.stringify(resultOf(completed, 'second-pwd'))).toContain(yield* files.realPath(destination.path));
      const recorded = yield* db
        .select({ entry: threadEntry().entry })
        .from(threadEntry())
        .where(and(eq(threadEntry().threadId, mover.thread.id), eq(threadEntry().type, 'context-change')));
      expect(yield* Effect.forEach(recorded, (row) => Schema.decodeUnknownEffect(ThreadContextChangeEntry)(row.entry))).toMatchObject([
        { status: 'published', sourceKey: targetSourceKey(destination.rootId) },
      ]);
      const opener = yield* db
        .select({ threadId: threadEntry().threadId, entry: threadEntry().entry })
        .from(threadEntry())
        .where(eq(threadEntry().type, WORKTREE_ENTRY));
      const parsed = yield* Effect.forEach(opener, (row) =>
        Effect.map(Schema.decodeUnknownEffect(WorktreeEntry)(row.entry), (entry) => ({ threadId: row.threadId, entry })),
      );
      expect(
        parsed
          .filter((row) => row.entry.rootId === destination.rootId && row.entry.event === 'created')
          .map((row) => [row.entry.rootId, row.threadId]),
      ).toEqual([[destination.rootId, opened.thread.id]]);
    }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(fixture)),
  58_000,
);
