import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Context, Effect, FileSystem, Schema, Stream } from 'effect';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import { subscriptionDescription } from '@runlith/builtin-catalog/subscription/description';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { threadEntry, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { sessionOfThread } from '../../../external-harnesses/testing/sessions.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { claudeLogin, nativeLeads } from '../claudeLogin.js';
import { SERVER_SRC } from '../repoRoot.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';
import { until } from './protocolRig.js';

const REMEMBER = 'Remember ORANGE-17 and read handover.txt.';
const ASK = 'Continue on Claude Code.';
const RECALL = 'Return to native.';
const seen: (readonly Message[])[] = [];
const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});
const answer = (id: string, text: string): readonly LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id },
  { type: 'text-delta', id, text },
  { type: 'text-end', id },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];
const read: readonly LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id: 'call_seal', name: 'read' },
  { type: 'tool-call', id: 'call_seal', name: 'read', input: { path: 'handover.txt' } },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];
const trace = Schema.fromJsonString(Schema.Struct({ event: Schema.String, messages: Schema.optional(Schema.Array(Schema.Unknown)) }));

describe('a native conversation crosses Claude Code and returns through the real doors', () => {
  layer(
    protocolWorld({
      name: 'protocol-handover',
      prepare: (world) => Effect.flatMap(claudeLogin(world), (account) => nativeLeads(world, account)),
      models: (standing) => ({
        ...standing,
        request: (selection) => ({
          ...standing.request(selection),
          text: () => Effect.die('the handover model only streams'),
          object: () => Effect.die('the handover model only streams'),
          stream: (input) =>
            Stream.suspend(() => {
              const messages = JSON.stringify(input.messages);
              if (!messages.includes(REMEMBER)) return Stream.fromIterable(answer('other', 'Nothing to do.'));
              if (messages.includes(RECALL)) {
                seen.push(input.messages);
                return Stream.fromIterable(answer('back', 'Back on native.'));
              }
              return Stream.fromIterable(input.messages.at(-1)?.role === 'tool' ? answer('noted', 'Noted.') : read);
            }),
        }),
      }),
    }),
    { excludeTestServices: true },
  )('protocol world', (it) => {
    it.effect(
      'native tool history is accepted as a vendor transcript, and the Claude answer reaches the next native request in one feed',
      () =>
        Effect.gen(function* () {
          const { world, projectId, checkout, agent, birth } = yield* ProtocolWorld;
          const files = yield* FileSystem.FileSystem;
          yield* files.writeFileString(join(checkout, 'handover.txt'), 'SEAL-42');
          const server = yield* Effect.acquireRelease(
            Effect.sync(() => Bun.serve({ port: 0, fetch: (request) => world.app(request, world.routed) })),
            (server) => Effect.tryPromise(() => server.stop(true)).pipe(Effect.orDie),
          );
          const report = yield* agent('handover');
          yield* files.writeFileString(
            join(dirname(report), WORLD_COMMAND),
            [
              '#!/bin/sh',
              `export TAGMA_SERVER_URL='http://127.0.0.1:${server.port}'`,
              `exec '${process.execPath}' '${join(SERVER_SRC, 'composition/testing/threads/protocolRunner.ts')}' --report '${report}' --server-door`,
            ].join('\n'),
            { mode: 0o755 },
          );
          const threadId = yield* birth();
          const db = Context.get(world.runtime.graph, MachineStore).db;
          const units = Context.get(world.runtime.graph, MachineUnits);
          const completed = (runId: string) =>
            until(
              units
                .read((unit) => unit.run(db.select().from(threadRun()).where(eq(threadRun().id, runId)).get()))
                .pipe(
                  Effect.flatMap((run) =>
                    run?.status === 'failed'
                      ? Effect.die(new Error(run.failureReason ?? 'the handover run failed'))
                      : Effect.succeed(run?.status === 'completed' ? run : null),
                  ),
                ),
              'completed the handover turn',
            );
          const entries = () =>
            units.read((unit) =>
              unit.run(db.select().from(threadEntry()).where(eq(threadEntry().threadId, threadId)).orderBy(threadEntry().ord).all()),
            );
          const turns = turnsOf(world.runtime.owners);
          yield* completed((yield* turns.send(threadId, projectId, REMEMBER)).runId);
          const native = { provider: subscriptionDescription.id, model: subscriptionDescription.defaultTextModel };
          const move = (provider: string, model: string) =>
            world.op('set_thread_model', { threadId, provider, model, reasoning: null, switches: {} }, `project=${projectId}`);
          expect((yield* move('claude-code', 'claude-opus-5-5')).status).toBe(200);
          const hosted = yield* completed((yield* turns.send(threadId, projectId, ASK)).runId);
          expect((yield* sessionOfThread(db, threadId))?.sessionKey).toBeString();
          const heard = yield* Effect.forEach((yield* files.readFileString(report)).split('\n').filter(Boolean), (line) =>
            Schema.decodeUnknownEffect(trace)(line),
          );
          const history = JSON.stringify(heard.find((entry) => entry.event === 'history' && (entry.messages?.length ?? 0) > 0)?.messages);
          expect(history).toContain(REMEMBER);
          expect(history).toContain('SEAL-42');
          expect(history).toContain('call_seal');
          expect(history).toContain('mcp__tagma__read');
          const replied = (yield* entries())
            .flatMap(({ entry }) =>
              coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant' && entry.runId === hosted.id ? [entry.text] : [],
            )
            .join('\n');
          expect(replied).toBe('done');
          expect((yield* move(native.provider, native.model)).status).toBe(200);
          expect(yield* sessionOfThread(db, threadId)).toBeNull();
          yield* completed((yield* turns.send(threadId, projectId, RECALL)).runId);
          const resumed = seen.at(-1) ?? [];
          expect(
            resumed.filter((message) => message.role === 'tool').some((message) => JSON.stringify(message.content).includes('SEAL-42')),
          ).toBe(true);
          expect(
            resumed.flatMap((message) =>
              message.role === 'assistant' ? message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])) : [],
            ),
          ).toContain(replied);
          expect(
            (yield* entries()).flatMap(({ entry }) =>
              coreEntry(entry) && entry.type === 'message' && entry.role === 'user' ? [entry.text] : [],
            ),
          ).toEqual([REMEMBER, ASK, RECALL]);
        }),
    );
  });
});
