import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { isAbsolute } from 'node:path';
import { gcAndSweep } from 'bun:jsc';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { openModelClient } from '@runlith/llm/models/client';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { answering } from '@runlith/llm/route/transport/answering';
import { Message } from '@runlith/llm/schema/messages';
import { recordedRegistrations } from '@runlith/builtin-catalog/registrations';
import { HeapSnapshots, heapSnapshotsLayer } from '@runlith/performance/HeapSnapshots';
import { ASKS_NEVER } from '@runlith/agent/permissions';
import { modelRequester } from '@runlith/agent/ModelRequests';
import { Tool } from '@runlith/agent/tool';
import type { ToolCatalog } from '@runlith/agent/catalog';

const parent = process.argv[2];
if (parent === undefined || !isAbsolute(parent)) throw new Error('Pass the absolute parent directory for snapshots.');

const credentials: ModelCredentials = {
  apiKey: async () => 'test-key',
  accessToken: async () => 'test-token',
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'identity',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'account', email: 'test@example.com' },
    organization: { uuid: 'organization', name: '' },
    accountId: undefined,
  }),
};

const names = ['read', 'search', 'write', 'edit', 'list', 'inspect'];
const tools: ToolCatalog = Object.fromEntries(
  names.map((name) => [
    name,
    Tool.make({
      description: `${name} one object.`,
      parameters: Schema.Struct({ path: Schema.String }),
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      execute: () => Effect.void,
    }),
  ]),
);
const answer = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
});

const program = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(parent, { recursive: true });
  const directory = yield* files.makeTempDirectory({ directory: parent, prefix: 'selections-' });
  return yield* Effect.gen(function* () {
    const snapshots = yield* HeapSnapshots;
    const client = yield* openModelClient(
      answering(
        () =>
          new Response(`data: ${answer}\n\ndata: [DONE]\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    );
    const request = modelRequester(modelCatalog([recordedRegistrations.stepfun]), credentials, client).request({
      ownerId: 'bench',
      provider: recordedRegistrations.stepfun.id,
      model: 'step-5-preview',
    });
    const call = (mask: number) =>
      Stream.runDrain(
        request.stream({
          messages: [Message.user('answer')],
          tools,
          activeTools: names.filter((_, bit) => (mask & (1 << bit)) !== 0),
        }),
      );
    for (let mask = 0; mask < 16; mask++) yield* call(mask);
    yield* Effect.sync(gcAndSweep);
    const warm = yield* snapshots.capture({ requestedBy: 'tool-selection-bench:warm' });
    for (let mask = 16; mask < 64; mask++) yield* call(mask);
    yield* Effect.sync(gcAndSweep);
    const loaded = yield* snapshots.capture({ requestedBy: 'tool-selection-bench:loaded' });
    console.log(JSON.stringify({ directory, catalog: names, warmSelections: 16, loadedSelections: 64, warm, loaded }));
  }).pipe(Effect.provide(heapSnapshotsLayer({ directory, instanceId: `tool-selection-${process.pid}` })));
}).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer));

BunRuntime.runMain(program);
