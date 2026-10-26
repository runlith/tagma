import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { WorldFiles } from '../../executions/contract/service/worlds.js';
import { agentSource } from './agents.js';

const guest: Caller = {
  actor: {
    kind: 'thread',
    threadId: 't1',
    projectId: 7,
    principalId: 'owner',
    session: { harness: NATIVE_HARNESS, key: 't1' },
  },
  files: { path: '/scratch', resolve: (candidate) => candidate },
};

it.effect('a declaration file named from a world with no filesystem refuses agent-source before any read', () =>
  Effect.gen(function* () {
    const refused = yield* Effect.flip(agentSource({ sourceFile: '/workspace/reader.md' }, guest)).pipe(
      Effect.provideService(WorldFiles, { files: undefined }),
    );
    expect(refused.code).toBe('agent-source');
  }),
);

it.effect('declaration text given directly needs no filesystem', () =>
  Effect.gen(function* () {
    const source = yield* agentSource({ source: 'Answer briefly.' }, guest).pipe(Effect.provideService(WorldFiles, { files: undefined }));
    expect(source).toBe('Answer briefly.');
  }),
);
