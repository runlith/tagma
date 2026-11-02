import { createHash } from 'node:crypto';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import * as sdk from '@cursor/sdk';
import { cursorSdk } from './sdk.js';

it.live('a Cursor fork retains the selected vendor checkpoint and independent history', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'cursor-fork-' });
    const source = `${root}/source`;
    const store = new sdk.JsonlLocalAgentStore(source);
    const id = 'cursor-source';
    const blob = (name: string) => new TextEncoder().encode(`opaque:${name}`);
    const blobId = (name: string) => createHash('sha256').update(blob(name)).digest('hex');
    const ref = (name: string): sdk.LocalAgentCheckpointRef => ({ schemaVersion: 1, rootBlobId: blobId(name) });
    const agent: sdk.LocalAgentDocument = {
      agentId: id,
      cwd: '/work',
      status: 'idle',
      activeRunId: 'run-3',
      createdAt: 1,
      updatedAt: 4,
      latestCheckpoint: ref('three'),
      sdkMetadata: { blobEncryptionKey: 'opaque-key', mode: 'agent' },
    };
    const runs: sdk.LocalAgentRunDocument[] = ['one', 'two', 'three'].map((blob, index) => ({
      agentId: id,
      runId: `run-${index + 1}`,
      turnNumber: index + 1,
      status: 'finished',
      createdAt: index + 1,
      updatedAt: index + 2,
      startCheckpointRef: index === 0 ? null : ref(['one', 'two'][index - 1]!),
      latestCheckpointRef: ref(blob),
    }));
    yield* Effect.promise(async () => {
      await store.agents.create({ agent });
      for (const run of runs) await store.runs.create({ run });
      for (const name of ['one', 'two', 'three']) await store.checkpoints.create({ agentId: id, blobId: blobId(name), data: blob(name) });
      await store.runEvents.append({ runId: 'run-2', eventType: 'vendor-event', payload: { body: 'opaque' } });
    });
    const boundary = cursorSdk(sdk);
    const after = `${root}/after`;
    const before = `${root}/before`;
    yield* boundary.fork({ id, source, directory: after, cwd: '/work', through: 'run-2', turn: null });
    yield* boundary.fork({ id, source, directory: before, cwd: '/work', through: null, turn: 'run-3' });
    for (const directory of [after, before]) {
      const copy = new sdk.JsonlLocalAgentStore(directory);
      const copied = yield* Effect.promise(async () => ({
        agent: await copy.agents.get({ agentId: id }),
        runs: (await copy.runs.list({ filter: { agentIds: [id] } })).items,
        blob: await copy.checkpoints.get({ agentId: id, blobId: blobId('two') }),
        events: (await copy.runEvents.list({ runId: 'run-2' })).items,
      }));
      expect(copied.agent).toMatchObject({ agentId: id, latestCheckpoint: ref('two'), sdkMetadata: agent.sdkMetadata });
      expect(copied.runs.map((run) => run.runId)).toEqual(['run-1', 'run-2']);
      expect(new TextDecoder().decode(copied.blob!)).toBe('opaque:two');
      expect(copied.events).toMatchObject([{ eventType: 'vendor-event', payload: { body: 'opaque' } }]);
    }
    expect((yield* Effect.promise(() => store.agents.get({ agentId: id })))?.latestCheckpoint).toEqual(ref('three'));
    expect(
      yield* Effect.flip(boundary.fork({ id, source, directory: `${root}/missing`, cwd: '/work', through: 'missing', turn: null })),
    ).toMatchObject({ code: -32002 });
    yield* Effect.promise(() => store.checkpoints.update({ agentId: id, blobId: blobId('two'), data: blob('invalid') }));
    expect(
      yield* Effect.flip(boundary.fork({ id, source, directory: `${root}/corrupt`, cwd: '/work', through: 'run-2', turn: null })),
    ).toMatchObject({ code: -32603 });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
