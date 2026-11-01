import { Cause, Clock, Effect, Exit, Result, Schema, Scope, Stream } from 'effect';

import { activity, activityStream, CurrentActivity, type ActivityEnding } from '@runlith/activity/Activity';
import { MODEL_CALL, type ModelCallAttrs, type ModelCallResult, type ModelCallUsage } from '@runlith/activity/modelCall';
import * as LLM from '@runlith/llm/call';
import type { ModelClient } from '@runlith/llm/models/client';
import { resolveCachePolicy } from '@runlith/llm/cache-policy';
import { LLMError, InvalidProviderOutputReason } from '@runlith/llm/schema/errors';
import { type LLMEvent, LLMResponse, type Usage } from '@runlith/llm/schema/events';
import { LLMRequest, Message, ToolDefinition, type ToolResultPart } from '@runlith/llm/schema/messages';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { resolveModelCall } from '@runlith/llm/models/resolve';
import type { ModelCredentials, ProviderRegistration } from '@runlith/llm/profiles/contract';
import {
  type ErrandMeasure,
  mapWebTools,
  type ServedWeb,
  type ServedWebCall,
  type VendorWeb,
  type VendorWebCall,
  type WebPageCall,
  type WebTool,
} from '@runlith/llm/profiles/vendorWeb';
import type { HttpExecutor } from '@runlith/llm/route/executor';
import type {
  ModelAnswerShape,
  ModelCallStep,
  ModelCompactionInput,
  ModelOneShotInput,
  ModelRequest,
  ModelRequestInput,
  ModelRequester,
  ModelStreamInput,
} from './modelPort';
import { describedTool, type Tool } from './tool';
import type { ToolCatalog } from './ToolCatalog';
import { toolSearchReferences } from './AgentDeferredTools';
import { type LlmClient, fold, stream } from '@runlith/llm/route/client';
import * as ResponseFold from '@runlith/llm/schema/responseFold';

export function modelRequester(
  catalog: ModelCatalog<ProviderRegistration>,
  credentials: ModelCredentials,
  client: ModelClient,
): ModelRequester {
  return {
    request: (input) => prepared(catalog, input, credentials, client),
  };
}

function prepared(
  catalog: ModelCatalog<ProviderRegistration>,
  input: ModelRequestInput,
  credentials: ModelCredentials,
  clientContext: ModelClient,
): ModelRequest {
  const resolution = resolveModelCall(catalog, { ...input, credentials });
  if (Result.isFailure(resolution)) {
    return refusedModelRequest(resolution.failure, {
      provider: input.provider,
      model: input.model ?? null,
      rung: input.reasoning ?? null,
    });
  }
  const resolved = resolution.success;
  const compaction = resolved.compaction;
  const system = input.instructions ? [{ type: 'text' as const, text: input.instructions }] : [];
  const base = (call: ModelStreamInput | ModelOneShotInput | ModelCompactionInput) => {
    const stallMs = 'stallMs' in call && call.stallMs !== undefined ? call.stallMs : input.stallMs;
    return Effect.map(
      resolved.model,
      (model) =>
        new LLMRequest({
          model,
          system,
          messages: callMessages(call, resolved.images),
          tools: [],
          cache: input.cache || undefined,
          liveness: stallMs,
          generation: resolved.maxOutputTokens === null ? undefined : { maxTokens: resolved.maxOutputTokens },
          providerOptions: resolved.providerOptions,
        }),
    );
  };
  const attrs = (step?: ModelCallStep): ModelCallAttrs => ({
    provider: resolved.identity.provider,
    model: resolved.identity.model,
    rung: resolved.rung,
    step: step === undefined ? undefined : step.number,
    attempt: step === undefined ? undefined : step.attempt,
  });
  const ended = (response: LLMResponse | undefined, firstEventMs?: number): ActivityEnding<ModelCallResult> => {
    const usage = response === undefined ? undefined : LLMResponse.usage(response);
    const account = credentials.selectedAccount;
    return {
      result: {
        account: account,
        usage: usage === undefined ? undefined : usageOf(usage),
        finish: response === undefined ? undefined : response.finishReason,
        firstEventMs: firstEventMs,
      },
      bodies:
        response === undefined
          ? undefined
          : [{ kind: 'response', contentType: 'application/json', encoded: ResponseFold.answer(response) }],
    };
  };
  const measure: ErrandMeasure = (model, work) =>
    activity(MODEL_CALL, { ...attrs(), model, rung: model === resolved.identity.model ? resolved.rung : null }, work, {
      ended: (exit) => ({ ...ended(Exit.isSuccess(exit) ? exit.value.response : undefined), ...failureOf(exit) }),
    }).pipe(Effect.map((read) => read.value));
  const oneShot = <A>(
    call: ModelOneShotInput,
    work: (request: LLMRequest) => Effect.Effect<A, LLMError, LlmClient>,
    responseOf: (value: A) => LLMResponse,
  ): Effect.Effect<A, LLMError> =>
    activity(MODEL_CALL, attrs(), Effect.flatMap(base(call), work).pipe(Effect.provideContext(clientContext)), {
      ended: (exit) => ({ ...ended(Exit.isSuccess(exit) ? responseOf(exit.value) : undefined), ...failureOf(exit) }),
    });
  return {
    plannedOutputTokens: resolved.plannedOutputTokens,
    images: resolved.images,
    retry: resolved.retry,
    continuation: resolved.continuation,
    origin: resolved.identity,
    rung: resolved.rung,
    cache: resolveCachePolicy(input.cache),
    toolChoice: resolved.toolChoice,
    web: resolved.web === undefined ? undefined : Effect.map(resolved.web, (web) => servedWeb(web, clientContext, measure)),
    system: input.instructions || undefined,
    providerOptions: resolved.providerOptions,
    resultRetention: resolved.resultRetention,
    compaction:
      compaction === undefined
        ? undefined
        : {
            select: compaction.select.bind(compaction),
            summarize: (call: ModelCompactionInput) =>
              activity(
                MODEL_CALL,
                attrs(),
                Effect.flatMap(base(call), (prepared) => {
                  const request = LLMRequest.update(prepared, {
                    system: [{ type: 'text', text: call.instructions }],
                    tools: call.tools,
                    compaction: call.context,
                  });
                  return fold(request, undefined).pipe(
                    Effect.flatMap((response) => {
                      const summary = compaction.summary(response);
                      if (response.finishReason !== 'stop' || summary.trim().length === 0) {
                        return Effect.fail(malformed(request, 'The compaction response must finish with a non-empty summary.', 'compact'));
                      }
                      return Effect.succeed({ summary, response });
                    }),
                  );
                }).pipe(Effect.provideContext(clientContext)),
                { ended: (exit) => ({ ...ended(Exit.isSuccess(exit) ? exit.value.response : undefined), ...failureOf(exit) }) },
              ),
          },
    stream: (call) =>
      Stream.suspend(() => {
        let folded = ResponseFold.empty(resolved.identity);
        let sentAt: number | undefined;
        let firstEventMs: number | undefined;
        return activityStream(
          MODEL_CALL,
          attrs(call.step),
          Stream.unwrap(
            Effect.gen(function* () {
              const opened = yield* CurrentActivity;
              if (opened !== null) call.opened?.(opened.id);
              const request = LLMRequest.update(yield* base(call), {
                tools: wireToolDefinitions(call.tools, call.activeTools),
                ...(call.toolChoice ? { toolChoice: toolChoice(call.toolChoice) } : {}),
              });
              sentAt = yield* Clock.currentTimeMillis;
              const scope = yield* Scope.make();
              return stream(request, scope).pipe(Stream.ensuring(Scope.close(scope, Exit.void)));
            }),
          ).pipe(
            Stream.tap((event) => {
              folded = ResponseFold.reduce(folded, event);
              if (firstEventMs !== undefined || sentAt === undefined) return Effect.void;
              const started = sentAt;
              return Effect.map(Clock.currentTimeMillis, (at) => {
                firstEventMs = at - started;
              });
            }),
            Stream.provideContext(clientContext),
          ),
          {
            ended: (exit) => ({ ...ended(ResponseFold.complete(folded), firstEventMs), ...failureOf(exit) }),
          },
        );
      }) as Stream.Stream<LLMEvent, LLMError>,
    text: (call) =>
      oneShot(
        call,
        (request) => fold(request, call.onEvent),
        (response) => response,
      ),
    object: (call) =>
      oneShot(
        call,
        (request) => answer(request, call),
        (answered) => answered.response,
      ),
  };
}

function servedWeb(web: VendorWeb, client: ModelClient, measure: ErrandMeasure): ServedWeb {
  const serve = <C>(tool: WebTool<C & VendorWebCall, HttpExecutor>): WebTool<C & ServedWebCall, never> => ({
    wire: tool.wire,
    input: tool.input,
    reads: tool.reads,
    targets: tool.targets,
    run: (input, call) => tool.run(input, { ...call, measure }).pipe(Effect.provideContext(client)),
  });
  return web.lifetimes === undefined
    ? { tools: mapWebTools(web.tools, serve<unknown>) }
    : { lifetimes: web.lifetimes, tools: mapWebTools(web.tools, serve<WebPageCall>) };
}

export function refusedModelRequest(failure: LLMError, asked: ModelCallAttrs): ModelRequest {
  const refused = activity(MODEL_CALL, asked, Effect.fail(failure), {
    ended: () => ({ outcome: 'refused', reason: failure.reason._tag, message: failure.message }),
  });
  return {
    plannedOutputTokens: 0,
    refusal: failure,
    stream: () => Stream.fromEffect(refused),
    text: () => refused,
    object: () => refused,
  };
}

export function wireToolDefinitions(catalog: ToolCatalog, active: readonly string[] | undefined): readonly ToolDefinition[] {
  let held = wireFootprints.get(catalog);
  if (held === undefined) {
    held = {
      all: Object.entries(catalog).map(([name, tool]) =>
        ToolDefinition.make({
          name,
          description: describedTool(tool),
          inputSchema: tool.inputSchema,
          deferred: tool.exposure === 'deferred' ? (true as const) : undefined,
          vendorWire: tool.vendor,
        }),
      ),
    };
    wireFootprints.set(catalog, held);
  }
  if (active === undefined) return held.all;
  const key = selectionKey(active);
  if (held.selected?.key === key) return held.selected.definitions;
  const names = new Set(active);
  const definitions = held.all.filter((definition) => names.has(definition.name));
  held.selected = { key, definitions };
  return definitions;
}

type WireSelection = { readonly key: string; readonly definitions: readonly ToolDefinition[] };
type WireFootprints = { readonly all: readonly ToolDefinition[]; selected?: WireSelection };
const wireFootprints = new WeakMap<ToolCatalog, WireFootprints>();

function selectionKey(active: readonly string[]): string {
  return active.map((name) => `${name.length}:${name}`).join('');
}

function toolChoice(choice: NonNullable<ModelStreamInput['toolChoice']>) {
  return choice === 'required' ? { type: 'required' as const } : { type: 'tool' as const, name: choice.toolName };
}

function answer<T>(
  request: LLMRequest,
  shape: ModelAnswerShape<T> & { readonly onEvent?: ModelOneShotInput['onEvent'] },
): Effect.Effect<{ readonly object: T; readonly response: LLMResponse }, LLMError, LlmClient> {
  const input = { ...LLM.requestInput(request), onEvent: shape.onEvent };
  if (shape.jsonSchema === undefined) {
    return LLM.generateObject({ ...input, schema: shape.schema }).pipe(
      Effect.map((answered) => ({ object: answered.object as T, response: answered.response })),
    );
  }
  return LLM.generateObject({ ...input, jsonSchema: shape.jsonSchema }).pipe(
    Effect.flatMap((answered) =>
      Schema.decodeUnknownEffect(shape.schema)(answered.object).pipe(
        Effect.mapError((issue) => malformed(request, issue.message)),
        Effect.map((object) => ({ object, response: answered.response })),
      ),
    ),
  );
}

function malformed(request: LLMRequest, detail: string, method = 'generateObject'): LLMError {
  return new LLMError({
    module: 'LLM',
    method,
    reason: new InvalidProviderOutputReason({
      message: `The answer from ${String(request.model.id)} did not satisfy the requested shape: ${detail}`,
    }),
  });
}

function callMessages(call: ModelStreamInput | ModelOneShotInput, images: boolean): readonly Message[] {
  const messages = 'tools' in call ? call.messages : (call.messages ?? [Message.user(call.prompt)]);
  return (images ? messages : picturesLeftOut(messages)).map((message) => {
    const content = message.content.map((part) => {
      if (part.type !== 'tool-result') return part;
      const references = toolSearchReferences(part);
      return references.length === 0 ? part : { ...part, toolReferences: references };
    });
    return content.every((part, index) => part === message.content[index]) ? message : new Message({ ...message, content });
  });
}

export function picturesLeftOut(messages: readonly Message[]): readonly Message[] {
  return messages.map((message) => {
    const content = message.content.map((part) => {
      if (part.type === 'media' && part.mediaType.startsWith('image/')) {
        return { type: 'text' as const, text: omittedPicture(part.filename ?? part.mediaType) };
      }
      return part.type === 'tool-result' ? withoutPictures(part) : part;
    });
    return content.every((part, index) => part === message.content[index]) ? message : new Message({ ...message, content });
  });
}

function withoutPictures(part: ToolResultPart): ToolResultPart {
  if (part.result.type !== 'content') return part;
  if (!part.result.value.some((item) => item.type === 'file' && item.mime.startsWith('image/'))) return part;
  return {
    ...part,
    result: {
      type: 'content',
      value: part.result.value.map((item) =>
        item.type === 'file' && item.mime.startsWith('image/')
          ? { type: 'text' as const, text: omittedPicture(item.name ?? item.mime) }
          : item,
      ),
    },
  };
}

function omittedPicture(label: string): string {
  return `[Picture ${label} is left out: this model takes no images.]`;
}

function usageOf(usage: Usage): ModelCallUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    reasoningTokens: usage.reasoningTokens,
  };
}

function failureOf(exit: Exit.Exit<unknown, unknown>): {
  readonly outcome?: 'failed';
  readonly reason?: string;
  readonly message?: string;
} {
  if (Exit.isSuccess(exit)) return {};
  const found = Cause.findError(exit.cause);
  if (found._tag !== 'Success' || !(found.success instanceof LLMError)) return {};
  return { outcome: 'failed', reason: found.success.reason._tag, message: found.success.message };
}
