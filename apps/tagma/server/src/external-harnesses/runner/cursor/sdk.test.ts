import { expect, spyOn } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import * as sdk from '@cursor/sdk';
import type { OutputEvent } from '@runlith/hosted-runner/output';
import { cursorSdk } from './sdk.js';

it.effect('Cursor seals a message after its calls, returns hosted results and reports whole-turn token usage', () =>
  Effect.gen(function* () {
    const agent: sdk.SDKAgent = {
      agentId: 'session',
      model: undefined,
      close: () => {},
      reload: async () => {},
      [Symbol.asyncDispose]: async () => {},
      listArtifacts: async () => [],
      downloadArtifact: async () => Buffer.alloc(0),
      getUsage: async () => {
        throw new Error('usage comes from the run');
      },
      send: async (_message, options) => {
        const run: sdk.Run = {
          id: 'run',
          agentId: 'session',
          status: 'running',
          supports: () => true,
          unsupportedReason: () => undefined,
          async *stream() {},
          conversation: async () => [],
          cancel: async () => {},
          onDidChangeStatus: () => () => {},
          wait: async () => {
            const delta = options!.onDelta!;
            await delta({ update: { type: 'step-started', stepId: 1 } });
            await delta({ update: { type: 'text-delta', text: 'reading' } });
            await delta({ update: { type: 'tool-requests-listed', callCount: 1 } });
            await delta({
              update: {
                type: 'tool-call-started',
                callId: 'call-1',
                modelCallId: 'model-1',
                toolCall: { type: 'mcp', args: { providerIdentifier: 'custom-user-tools', toolName: 'read', args: { path: '/input' } } },
              },
            });
            const answered = await options!.local!.customTools!.read!.execute({ path: '/input' }, { toolCallId: 'call-1' });
            expect(answered).toEqual({ content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }], isError: true });
            await delta({
              update: {
                type: 'tool-call-completed',
                callId: 'call-1',
                modelCallId: 'model-1',
                toolCall: {
                  type: 'mcp',
                  args: { providerIdentifier: 'custom-user-tools', toolName: 'read' },
                  result: { status: 'success', value: { content: [], isError: true } },
                },
              },
            });
            await delta({ update: { type: 'step-completed', stepId: 1, stepDurationMs: 1 } });
            return {
              id: 'run',
              status: 'finished',
              result: JSON.stringify(answered),
              usage: {
                inputTokens: 13,
                outputTokens: 4,
                cacheReadTokens: 3,
                cacheWriteTokens: 2,
                reasoningTokens: 1,
                totalTokens: 17,
              },
            };
          },
        };
        return run;
      },
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => spyOn(sdk.Agent, 'create').mockResolvedValue(agent)),
      (spy) => Effect.sync(() => spy.mockRestore()),
    );
    const channel = yield* cursorSdk(sdk).open({ id: null, cwd: '/work', directory: '/store', apiKey: 'key', model: undefined });
    const events: OutputEvent[] = [];
    const calls: string[] = [];
    const run = yield* channel.send({
      id: 'turn',
      message: { text: 'read it', images: [] },
      model: undefined,
      force: false,
      tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' }, mutates: false }],
      event: (event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      call: (id, name, args) =>
        Effect.sync(() => {
          calls.push(`${id}:${name}:${JSON.stringify(args)}`);
          expect(events.filter((event) => event.type === 'said')).toEqual([
            { type: 'said', said: { messageId: 'turn:1', toolCallIds: ['call-1'] } },
          ]);
          return { content: [{ type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' }], failed: true };
        }),
    });
    expect(yield* run.wait).toMatchObject({
      status: 'finished',
      usage: { inputTokens: 13, outputTokens: 4, cachedReadTokens: 3, cachedWriteTokens: 2, thoughtTokens: 1, totalTokens: 17 },
    });
    expect(calls).toEqual(['call-1:read:{"path":"/input"}']);
    expect(events.filter((event) => event.type === 'call' || event.type === 'result')).toMatchObject([
      { type: 'call', hosted: true, call: { toolCallId: 'call-1', name: 'read', status: 'pending' } },
      {
        type: 'result',
        hosted: true,
        result: {
          toolCallId: 'call-1',
          status: 'failed',
          content: [{ type: 'content', content: { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' } }],
        },
      },
    ]);
    yield* channel.close;
  }),
);

it.effect('terminal SDK error codes retain login and capacity failure semantics before a model response', () =>
  Effect.gen(function* () {
    const agent: sdk.SDKAgent = {
      agentId: 'session',
      model: undefined,
      close: () => {},
      reload: async () => {},
      [Symbol.asyncDispose]: async () => {},
      listArtifacts: async () => [],
      downloadArtifact: async () => Buffer.alloc(0),
      getUsage: async () => {
        throw new Error('unused');
      },
      send: async (message) => ({
        id: 'run',
        agentId: 'session',
        status: 'error',
        supports: () => true,
        unsupportedReason: () => undefined,
        async *stream() {},
        conversation: async () => [],
        cancel: async () => {},
        onDidChangeStatus: () => () => {},
        wait: async () => ({
          id: 'run',
          status: 'error',
          error: { message: 'rejected', code: typeof message === 'string' ? message : message.text },
        }),
      }),
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => spyOn(sdk.Agent, 'create').mockResolvedValue(agent)),
      (spy) => Effect.sync(() => spy.mockRestore()),
    );
    const channel = yield* cursorSdk(sdk).open({ id: null, cwd: '/work', directory: '/store', apiKey: 'key', model: undefined });
    for (const [code, family, retryable] of [
      ['unauthenticated', 'auth', false],
      ['resource_exhausted', 'rate-limit', true],
    ] as const) {
      const run = yield* channel.send({
        id: code,
        message: { text: code, images: [] },
        model: undefined,
        force: false,
        tools: [],
        event: () => Effect.void,
        call: () => Effect.die('no tools'),
      });
      expect(yield* run.wait).toMatchObject({ status: 'error', failure: { modelStarted: false, retryable, reason: { family } } });
    }
    yield* channel.close;
  }),
);

it.effect('Cursor login and missing persisted sessions keep distinct public failures', () =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() => spyOn(sdk.Agent, 'create').mockRejectedValue(new sdk.AuthenticationError('invalid key'))),
      (spy) => Effect.sync(() => spy.mockRestore()),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => spyOn(sdk.Agent, 'resume').mockRejectedValue(new sdk.AgentNotFoundError('session missing'))),
      (spy) => Effect.sync(() => spy.mockRestore()),
    );
    const boundary = cursorSdk(sdk);
    const input = { cwd: '/work', directory: '/store', apiKey: 'invalid', model: undefined };
    expect(yield* Effect.flip(boundary.open({ ...input, id: null }))).toMatchObject({ code: -32000, message: 'invalid key' });
    expect(yield* Effect.flip(boundary.open({ ...input, id: 'missing' }))).toMatchObject({ code: -32002, message: 'session missing' });
  }),
);
