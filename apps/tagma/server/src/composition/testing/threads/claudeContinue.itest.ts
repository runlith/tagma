import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Schema, Stream } from 'effect';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, evidenceOf, turnsOf } from '../../../threads/testing/doubles.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { claudeLogin, nativeLeads } from '../claudeLogin.js';
import { SERVER_SRC } from '../repoRoot.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';
import { until } from './protocolRig.js';

const trace = Schema.fromJsonString(
  Schema.Struct({
    event: Schema.String,
    sessionId: Schema.optional(Schema.String),
    messages: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, uuid: Schema.String }))),
  }),
);

layer(
  protocolWorld({
    name: 'claude-continue',
    prepare: (world) => Effect.flatMap(claudeLogin(world), (account) => nativeLeads(world, account)),
    models: (standing) => ({
      ...standing,
      request: (selection) => ({
        ...standing.request(selection),
        stream: (input) =>
          Stream.fromIterable<LLMEvent>(
            JSON.stringify(input.messages).includes('continue-worker') &&
              !input.messages.some(
                (message) =>
                  message.role === 'tool' && message.content.some((part) => part.type === 'tool-result' && part.id === 'resume-worker'),
              )
              ? [
                  { type: 'tool-input-start', id: 'resume-worker', name: 'continue_agent' },
                  { type: 'tool-call', id: 'resume-worker', name: 'continue_agent', input: { threadId: 'kit' } },
                  { type: 'finish', reason: 'tool-calls' },
                ]
              : [
                  { type: 'text-start', id: 'reply' },
                  { type: 'text-delta', id: 'reply', text: 'Noted.' },
                  { type: 'text-end', id: 'reply' },
                  { type: 'finish', reason: 'stop' },
                ],
          ),
      }),
    }),
  }),
  { excludeTestServices: true },
)('Claude Code continuation through the parent agent tool', (it) => {
  it.effect('continues after process death with a completed tool result and no new words for the child', () =>
    Effect.gen(function* () {
      const { world, projectId, agent } = yield* ProtocolWorld;
      const files = yield* FileSystem.FileSystem;
      const report = yield* agent('resume');
      const pid = `${report}.pid`;
      yield* files.writeFileString(
        join(dirname(report), WORLD_COMMAND),
        [
          '#!/bin/sh',
          `echo $$ > '${pid}'`,
          `exec '${process.execPath}' '${join(SERVER_SRC, 'composition/testing/threads/protocolRunner.ts')}' --report '${report}'`,
        ].join('\n'),
        { mode: 0o755 },
      );
      const parent = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'trust' })).thread
        .id;
      const kernel = Context.get(world.runtime.owners, ThreadHarness);
      const child = yield* kernel.collaboration.spawn({
        parentThreadId: parent,
        ownerId: 'operator',
        requestId: crypto.randomUUID(),
        agentId: 'tagma',
        name: 'kit',
        task: 'HOLD the turn.',
        model: { provider: 'claude-code' },
      });
      const threadId = child.threadId;
      yield* Effect.addFinalizer(() =>
        Effect.forEach([threadId, parent], (id) => {
          const handle = kernel.threads.handle(id, 'operator');
          return Effect.andThen(handle.stop(), handle.release()).pipe(Effect.orDie);
        }),
      );
      const snapshot = () => evidenceOf(world.runtime.owners).snapshot(threadId, projectId);
      const traces = Effect.fnUntraced(function* () {
        const text = yield* files.readFileString(report).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('')));
        return yield* Effect.forEach(text.split('\n').filter(Boolean), (line) => Schema.decodeUnknownEffect(trace)(line));
      });
      yield* until(
        Effect.map(traces(), (rows) => (rows.some((row) => row.event === 'model') ? true : null)),
        'opened the first Claude request',
      );
      yield* files.writeFileString(`${report}.vendor`, '');
      yield* until(
        Effect.map(snapshot(), (state) =>
          state.transcript.some((entry) => coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'vendor-call') ? true : null,
        ),
        'recorded the tool call',
      );
      yield* files.writeFileString(`${report}.result`, '');
      const before = yield* until(
        Effect.map(snapshot(), (state) =>
          state.transcript.some(
            (entry) =>
              coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'vendor-call' && entry.toolState === 'output-available',
          )
            ? state
            : null,
        ),
        'recorded the completed tool before process death',
      );
      const processId = Number.parseInt(yield* files.readFileString(pid), 10);
      yield* Effect.sync(() => process.kill(processId, 'SIGINT'));
      const ended = yield* until(
        Effect.map(snapshot(), (state) => (state.status.ending?.status === 'failed' ? state : null)),
        'failed the interrupted Claude process',
      );
      expect(ended.status.ending).toMatchObject({ status: 'failed' });
      yield* turnsOf(world.runtime.owners).send(parent, projectId, 'continue-worker');
      const after = yield* until(
        Effect.map(snapshot(), (state) =>
          state.status.ending !== undefined && state.status.ending.runId !== before.status.runId ? state : null,
        ),
        'settled the continued child run',
      );
      expect(after.status.ending).toMatchObject({ status: 'completed' });
      expect(
        after.transcript.some(
          (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant' && entry.text === 'done',
        ),
      ).toBe(true);
      const loaded = (yield* traces()).find((row) => row.event === 'history' && row.sessionId !== undefined);
      expect(loaded?.messages?.map((message) => message.type)).toEqual(['user', 'assistant', 'user']);
      expect(loaded?.messages?.at(-1)?.uuid).toBeString();
      const parentState = yield* until(
        Effect.map(evidenceOf(world.runtime.owners).snapshot(parent, projectId), (state) =>
          state.transcript.some(
            (entry) =>
              coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'resume-worker' && entry.toolState === 'output-available',
          )
            ? state
            : null,
        ),
        'recorded the continue_agent tool result',
      );
      expect(
        parentState.transcript.find((entry) => coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'resume-worker'),
      ).toMatchObject({ toolState: 'output-available' });
    }),
  );
});
