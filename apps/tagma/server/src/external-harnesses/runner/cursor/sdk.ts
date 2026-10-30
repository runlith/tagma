import { Deferred, Effect, Schema } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import { familyRetries, type WireFailureFamily } from '@runlith/llm/schema/errors';
import type { InteractionUpdate, SDKCustomTool, SDKJsonValue, TokenUsage } from '@cursor/sdk';
import { CursorSdk, type Outcome, type Sending } from './channel.js';
import type { CursorSelection } from '@runlith/adapter-cursor/selection';
import type { Relayed } from '@runlith/hosted-runner/relay';

const mutableJson = (value: Schema.Json): SDKJsonValue => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(mutableJson);
  return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, mutableJson(part)]));
};

export const cursorSdk = (module: typeof import('@cursor/sdk')): CursorSdk['Service'] => {
  const families: Readonly<Record<string, WireFailureFamily>> = {
    unauthenticated: 'auth',
    permission_denied: 'auth',
    resource_exhausted: 'rate-limit',
    unavailable: 'connect-timeout',
    deadline_exceeded: 'connect-timeout',
    internal: 'overloaded',
    data_loss: 'overloaded',
    invalid_argument: 'invalid-request',
    failed_precondition: 'invalid-request',
    not_found: 'no-route',
    plan_required: 'no-route',
  };
  const classified = (cause: unknown, modelStarted: boolean): TransportFailure => {
    const error = cause instanceof module.CursorSdkError ? cause : null;
    const family: WireFailureFamily = /cannot use this model/i.test(error?.message ?? '')
      ? 'no-route'
      : error?.code !== undefined && families[error.code] !== undefined
        ? families[error.code]!
        : cause instanceof module.AuthenticationError
          ? 'auth'
          : cause instanceof module.RateLimitError
            ? 'rate-limit'
            : cause instanceof module.NetworkError
              ? 'connect-timeout'
              : cause instanceof module.ConfigurationError
                ? 'invalid-request'
                : 'unknown';
    return {
      stage: 'cursor.turn',
      type: error?.name ?? 'Transport',
      httpStatus: error?.status,
      retryable: familyRetries(family),
      modelStarted,
      reason: { family, status: error?.status },
    };
  };
  const fault = (cause: unknown, modelStarted = false): AgentFault => {
    if (cause instanceof AgentFault) return cause;
    if (!(cause instanceof module.CursorSdkError)) throw cause;
    return new AgentFault({
      code:
        cause instanceof module.AgentNotFoundError
          ? FAULT.notFound
          : cause instanceof module.AuthenticationError
            ? FAULT.authRequired
            : cause.code === 'cancelled' || cause.code === 'canceled'
              ? -32800
              : FAULT.internal,
      message: cause.message,
      data: { 'tagma/failure': classified(cause, modelStarted) },
    });
  };
  const modelOf = (model: CursorSelection | undefined) =>
    model === undefined
      ? undefined
      : {
          id: model.id,
          params: model.params?.map((param) => ({ ...param })),
          maxMode: model.maxMode,
        };
  const usageOf = (usage: TokenUsage | undefined): Outcome['usage'] =>
    usage === undefined
      ? undefined
      : {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cachedReadTokens: usage.cacheReadTokens,
          cachedWriteTokens: usage.cacheWriteTokens,
          thoughtTokens: usage.reasoningTokens,
        };
  return CursorSdk.of({
    open: Effect.fn('CursorSdk.open')(function* (input) {
      const options = {
        apiKey: input.apiKey,
        model: modelOf(input.model),
        tools: ['mcp'] as ['mcp'],
        mode: 'agent' as const,
        local: {
          cwd: input.cwd,
          store: new module.JsonlLocalAgentStore(input.directory),
          settingSources: [],
          autoReview: false,
          sandboxOptions: { enabled: false },
          customTools: {},
        },
      };
      const agent = yield* Effect.tryPromise({
        try: () => (input.id === null ? module.Agent.create(options) : module.Agent.resume(input.id, options)),
        catch: fault,
      });
      return {
        id: agent.agentId,
        send: Effect.fn('CursorSdk.send')(function* (input: Sending) {
          const stopped = yield* Deferred.make<void>();
          const context = yield* Effect.context<never>();
          const runEffect = Effect.runPromiseWith(context);
          let messageId = `${input.id}:0`;
          let step = 0;
          let listed: number | null = null;
          let sealed = false;
          let summary = '';
          let latestUsage: TokenUsage | undefined;
          let modelStarted = false;
          const calls = new Set<string>();
          const returned = new Map<string, Relayed>();
          const seal = () => {
            if (sealed || listed === null || calls.size < listed) return Effect.void;
            sealed = true;
            return input.event({ type: 'said', said: { messageId, toolCallIds: [...calls] } });
          };
          const delta = Effect.fnUntraced(function* (update: InteractionUpdate) {
            switch (update.type) {
              case 'text-delta':
              case 'thinking-delta':
                modelStarted = true;
                yield* input.event({ type: 'phase', phase: update.type === 'text-delta' ? 'writing' : 'reasoning' });
                yield* input.event({ type: update.type === 'text-delta' ? 'text' : 'thought', messageId, text: update.text });
                break;
              case 'step-started':
                messageId = `${input.id}:${++step}`;
                calls.clear();
                listed = null;
                sealed = false;
                yield* input.event({ type: 'phase', phase: 'calling' });
                break;
              case 'tool-requests-listed':
                listed = update.callCount;
                yield* seal();
                break;
              case 'tool-call-started':
              case 'partial-tool-call':
              case 'tool-call-completed': {
                modelStarted = true;
                const tool = update.toolCall;
                if (tool.type !== 'mcp')
                  return yield* new AgentFault({ code: FAULT.internal, message: `Cursor invoked undeclared built-in tool ${tool.type}` });
                const name = tool.args.toolName;
                if (name === undefined) {
                  if (update.type === 'partial-tool-call') return;
                  return yield* new AgentFault({ code: FAULT.internal, message: `Cursor supplied no name for tool call ${update.callId}` });
                }
                const hosted = tool.args.providerIdentifier === undefined || tool.args.providerIdentifier === 'custom-user-tools';
                if (!hosted)
                  return yield* new AgentFault({
                    code: FAULT.internal,
                    message: `Cursor invoked undeclared MCP server ${tool.args.providerIdentifier}`,
                  });
                if (!calls.has(update.callId)) {
                  calls.add(update.callId);
                  yield* input.event({ type: 'phase', phase: 'tools' });
                  yield* input.event({
                    type: 'call',
                    hosted,
                    call: { toolCallId: update.callId, title: name, name, status: 'pending', rawInput: tool.args.args ?? {} },
                  });
                } else if (update.type !== 'tool-call-completed') {
                  yield* input.event({
                    type: 'result',
                    hosted: false,
                    result: { toolCallId: update.callId, rawInput: tool.args.args ?? {} },
                  });
                }
                yield* seal();
                if (update.type === 'tool-call-completed') {
                  const answer = returned.get(update.callId);
                  returned.delete(update.callId);
                  const failed =
                    answer?.failed ?? (tool.result?.status === 'error' || (tool.result?.status === 'success' && tool.result.value.isError));
                  yield* input.event({
                    type: 'result',
                    hosted,
                    result: {
                      toolCallId: update.callId,
                      status: failed ? 'failed' : 'completed',
                      content: answer?.content.map((content) => ({ type: 'content' as const, content })),
                      rawOutput: answer === undefined ? tool.result : { content: answer.content, isError: answer.failed },
                    },
                  });
                }
                break;
              }
              case 'step-completed':
                yield* seal();
                break;
              case 'summary-started':
                summary = '';
                yield* input.event({ type: 'phase', phase: 'compacting' });
                break;
              case 'summary':
                summary = update.summary;
                break;
              case 'summary-completed':
                yield* input.event({ type: 'compacted', summary, trigger: 'auto' });
                yield* input.event({ type: 'phase', phase: 'calling' });
                break;
              case 'turn-ended':
                latestUsage =
                  update.usage === undefined
                    ? undefined
                    : { ...update.usage, totalTokens: update.usage.inputTokens + update.usage.outputTokens };
                yield* seal();
                break;
            }
          });
          const tools: Record<string, SDKCustomTool> = {};
          for (const tool of input.tools) {
            const inputSchema = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(tool.inputSchema).pipe(
              Effect.mapError((cause) => fault(new Error(`The hosted schema of ${tool.name} is not JSON: ${String(cause)}`))),
            );
            tools[tool.name] = {
              description: tool.description,
              inputSchema: Object.fromEntries(Object.entries(inputSchema).map(([key, value]) => [key, mutableJson(value)])),
              annotations: { readOnlyHint: !tool.mutates, destructiveHint: tool.mutates },
              execute: (args, call) =>
                runEffect(
                  Effect.gen(function* () {
                    if (call.toolCallId === undefined)
                      return {
                        content: [{ type: 'text' as const, text: 'Cursor supplied no toolCallId; the tool was not executed.' }],
                        isError: true,
                      };
                    const answer = yield* Effect.raceFirst(
                      input.call(call.toolCallId, tool.name, args),
                      Effect.as(Deferred.await(stopped), {
                        content: [{ type: 'text' as const, text: 'The Cursor turn was cancelled.' }],
                        failed: true,
                      }),
                    );
                    returned.set(call.toolCallId, answer);
                    return { content: answer.content.map((part) => ({ ...part })), isError: answer.failed };
                  }),
                ),
            };
          }
          const run = yield* Effect.tryPromise({
            try: () =>
              agent.send(
                { text: input.message.text, images: [...input.message.images] },
                {
                  model: modelOf(input.model),
                  mode: 'agent',
                  local: { customTools: tools, force: input.force },
                  onDelta: ({ update }) => runEffect(delta(update)),
                },
              ),
            catch: (cause) => fault(cause, modelStarted),
          });
          return {
            wait: Effect.tryPromise({ try: () => run.wait(), catch: (cause) => fault(cause, modelStarted) }).pipe(
              Effect.map((result): Outcome => ({
                status: result.status,
                usage: usageOf(result.usage ?? latestUsage),
                detail: result.error?.message,
                failure:
                  result.status === 'error'
                    ? classified(
                        new module.CursorSdkError(result.error?.message ?? 'Cursor run failed', { code: result.error?.code }),
                        modelStarted,
                      )
                    : undefined,
              })),
              Effect.catchTag('AgentFault', (cause) =>
                cause.code === -32800 ? Effect.succeed<Outcome>({ status: 'cancelled' }) : Effect.fail(cause),
              ),
            ),
            cancel: Effect.andThen(Deferred.succeed(stopped, undefined), Effect.tryPromise({ try: () => run.cancel(), catch: fault })),
          };
        }),
        close: Effect.sync(() => agent.close()),
      };
    }),
  });
};
