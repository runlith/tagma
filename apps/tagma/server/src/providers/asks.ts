import { activity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import type { ModelCallUsage } from '@runlith/activity/modelCall';
import type { ModelOneShotInput, ModelRequest, ModelRequestInput } from '@runlith/agent/modelPort';
import { estimateThreadTokens } from '@runlith/agent/thread/compaction/measurement';
import { DecisionRefused, type DecisionAnswer, type DecisionRequest } from '@runlith/llm/decision';
import type { ModelOption } from '@runlith/llm/models/catalog';
import { isContextOverflowFailure } from '@runlith/llm/provider-error';
import {
  AuthenticationReason,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  LLMError,
  QuotaExceededReason,
  UnknownProviderReason,
} from '@runlith/llm/schema/errors';
import { LLMResponse, type Usage } from '@runlith/llm/schema/events';
import { ModelID, ProviderID, ReasoningEfforts, type JsonSchema } from '@runlith/llm/schema/ids';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { decisionVerdicts, textDecisionAsk } from '@runlith/llm/textDecision';
import type { AskKind, AskPath } from '@runlith/llm/models/description';
import type { ProgramAnswer } from '@runlith/tagma/adapter/provider';
import { Cause, Effect, Layer, Option, Schema, Semaphore, Stream } from 'effect';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { thisMachine } from '../platform/contract/service/capacity.js';
import { ProviderAccounts } from './contract/service/accounts.js';
import { ModelAccess } from './contract/service/access.js';
import {
  AskPrograms,
  AskRefused,
  DefaultSelection,
  ModelAsks,
  type Answered,
  type Asker,
  type AskSelection,
  type FreshAsk,
} from './contract/service/asks.js';
import { HarnessAccounts } from './contract/service/harness.js';
import type { AskRefusal } from './contract/wire/asks.js';
import { ProviderRegistry, type AskRoute, type ProviderCatalog } from './contract/service/registry.js';

export const ASK = activityKind<
  { readonly kind: AskKind; readonly path: AskPath; readonly provider: string; readonly model: string; readonly rung: string | null },
  { readonly account?: string; readonly usage?: ModelCallUsage }
>('ask');

const PROGRAM_OUTPUT_TOKENS = 8_192;
const PROGRAM_SETTLE_MS = 30_000;
const PROGRAM_MS_PER_OUTPUT_TOKEN = 25;

type ProgramRoute = Extract<AskRoute, { readonly path: 'program' }>;

type Spoken<A> = { readonly value: A; readonly usage: Usage | undefined; readonly account: string | undefined };

const refused = (refusal: AskRefusal, message: string, failure?: unknown, usage?: Usage) =>
  new AskRefused({ refusal, message, failure, usage });

export const refusalOf = (failure: LLMError): AskRefused => {
  if (isContextOverflowFailure(failure)) return refused('ask-input-too-large', failure.message, failure);
  switch (failure.reason._tag) {
    case 'Authentication':
    case 'NotInstalled':
    case 'AdapterFailed':
      return refused('ask-not-connected', failure.message, failure);
    case 'QuotaExceeded':
      return refused('ask-quota', failure.message, failure);
    case 'InvalidProviderOutput':
      return refused('ask-unreadable-answer', failure.message, failure);
    default:
      return refused('ask-provider-failed', failure.message, failure);
  }
};

const failureOf = (refusal: AskRefused): LLMError => {
  const message = refusal.message;
  const reason =
    refusal.refusal === 'ask-quota'
      ? new QuotaExceededReason({ message })
      : refusal.refusal === 'ask-not-connected'
        ? new AuthenticationReason({ message, kind: 'missing' })
        : refusal.refusal === 'ask-input-too-large'
          ? new InvalidRequestReason({ message, classification: 'context-overflow' })
          : refusal.refusal === 'ask-unreadable-answer'
            ? new InvalidProviderOutputReason({ message })
            : new UnknownProviderReason({ message });
  return new LLMError({ module: 'ModelAsks', method: 'program', reason });
};

const optionOf = (catalog: ProviderCatalog, provider: string, model: string): ModelOption | undefined =>
  catalog.models.registered(provider) ? catalog.models.modelsOf(provider).find((option) => option.id === model) : undefined;

export const lowestRung = (option: ModelOption): string | null => {
  const rank = (id: string) => {
    const at = ReasoningEfforts.indexOf(id as (typeof ReasoningEfforts)[number]);
    return at === -1 ? ReasoningEfforts.length : at;
  };
  return option.reasoningOptions.toSorted((left, right) => rank(left.id) - rank(right.id))[0]?.id ?? null;
};

const plannedOutput = (option: ModelOption | undefined): number =>
  Math.min(option?.capacity?.output ?? PROGRAM_OUTPUT_TOKENS, PROGRAM_OUTPUT_TOKENS);

const textOf = (messages: readonly Message[]): string =>
  messages.flatMap((message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))).join('\n\n');

const objectInstruction = (system: string, schema: JsonSchema) =>
  `${system}\n\nAnswer with one JSON value that matches this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`;

const parsedObject = (text: string): Effect.Effect<unknown, AskRefused> => {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/u.exec(text.trim());
  return Effect.try({
    try: () => JSON.parse(fenced === null ? text.trim() : fenced[1]!) as unknown,
    catch: (cause) => refused('ask-unreadable-answer', `The answer is not one JSON value: ${String(cause)}`),
  });
};

const responseOf = (text: string, usage: Usage | undefined) =>
  new LLMResponse({
    message: Message.assistant(text),
    events: [{ type: 'text-delta', id: 'answer', text }],
    usage,
    finishReason: 'stop',
  });

export const makeModelAsks = Effect.gen(function* () {
  const models = yield* ModelAccess;
  const registry = yield* ProviderRegistry;
  const accounts = yield* ProviderAccounts;
  const harnessAccounts = yield* HarnessAccounts;
  const programs = yield* AskPrograms;
  const defaults = yield* DefaultSelection;
  const log = yield* ActivityLog;
  const lanes = new Map<string, Semaphore.Semaphore>();
  const lanesPerProvider = Math.max(1, Math.floor(thisMachine().parallelism / 4));

  const laneOf = Effect.fnUntraced(function* (provider: string) {
    const held = lanes.get(provider);
    if (held !== undefined) return held;
    const made = yield* Semaphore.make(lanesPerProvider);
    lanes.set(provider, made);
    return made;
  });

  const routeOf = (catalog: ProviderCatalog, selection: { readonly provider: string; readonly model: string }) => {
    const route = catalog.asks.route(selection.provider, selection.model);
    return route === null
      ? Effect.fail(
          refused('ask-unanswerable', `${selection.provider}:${selection.model} answers no asks: its provider declares no ask path`),
        )
      : Effect.succeed(route);
  };

  const answers = (selection: { readonly provider: string; readonly model: string }, kind: AskKind) =>
    registry.current().asks.kinds(selection.provider, selection.model).includes(kind);

  const observed = <A>(
    kind: AskKind,
    path: AskPath,
    selection: AskSelection,
    work: Effect.Effect<Spoken<A>, AskRefused>,
  ): Effect.Effect<Answered<A>, AskRefused> =>
    Effect.provideService(
      activity(
        ASK,
        { kind, path, provider: selection.provider, model: selection.model, rung: selection.reasoning },
        Effect.map(work, (spoken) => ({ value: spoken.value, path, selection, usage: spoken.usage, account: spoken.account })),
        {
          ended: (exit) => {
            if (exit._tag === 'Success')
              return { result: { account: exit.value.account, usage: exit.value.usage === undefined ? undefined : exit.value.usage } };
            const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
            if (!(failure instanceof AskRefused)) return {};
            const before =
              failure.refusal === 'ask-not-connected' ||
              failure.refusal === 'ask-unanswerable' ||
              failure.refusal === 'ask-input-too-large' ||
              failure.refusal === 'ask-quota';
            return {
              outcome: before ? 'refused' : 'failed',
              reason: failure.refusal,
              message: failure.message,
              result: failure.usage === undefined ? undefined : { usage: failure.usage },
            };
          },
        },
      ),
      ActivityLog,
      log,
    );

  const requestOf = (
    route: AskRoute,
    selection: AskSelection,
    system: string,
    stallMs?: number,
  ): Effect.Effect<ModelRequest, AskRefused> => {
    const request = models.request({
      ownerId: OPERATOR_PRINCIPAL,
      provider: route.provider,
      model: selection.model,
      reasoning: selection.reasoning,
      account: selection.account ?? undefined,
      instructions: system,
      cache: 'none',
      reasoningOutput: false,
      stallMs,
    });
    return request.refusal === undefined ? Effect.succeed(request) : Effect.fail(refusalOf(request.refusal));
  };

  const launched = Effect.fnUntraced(function* (route: ProgramRoute, account: string | null) {
    const registration = registry.current().harnesses.find((provider) => provider.id === route.provider);
    if (registration === undefined) return yield* refused('ask-not-connected', `${route.provider} is not installed`);
    const launch = yield* harnessAccounts
      .launch(route.provider, account ?? undefined)
      .pipe(
        Effect.mapError((failure) =>
          failure instanceof GateRefusal
            ? refused('ask-not-connected', failure.reason, failure)
            : refused('ask-provider-failed', `the accounts of ${route.provider} could not be read`, failure),
        ),
      );
    if (launch !== null) return { entries: launch.entries, account: String(launch.account) };
    return { entries: registration.auth === 'cli' ? registration.environment(null) : [], account: undefined };
  });

  const programAnswer = Effect.fnUntraced(function* (
    route: ProgramRoute,
    selection: AskSelection,
    system: string,
    input: string,
    schema?: JsonSchema,
  ) {
    const catalog = registry.current();
    const option = optionOf(catalog, route.provider, selection.model);
    const output = plannedOutput(option);
    const context = option?.capacity?.context;
    const asked = schema === undefined || route.program.schemas ? system : objectInstruction(system, schema);
    if (context !== undefined && estimateThreadTokens(asked) + estimateThreadTokens(input) > context - output)
      return yield* refused('ask-input-too-large', `The input takes more than ${selection.model} reads beside its answer`);
    const environment = yield* launched(route, selection.account);
    const argv = route.program.argv({
      model: selection.model,
      rung: selection.reasoning,
      system: asked,
      schema: schema !== undefined && route.program.schemas ? schema : undefined,
    });
    const lane = yield* laneOf(route.provider);
    const ran = yield* lane.withPermits(1)(
      programs.run({
        provider: route.provider,
        command: route.program.command,
        argv,
        entries: environment.entries,
        input,
        deadlineMs: PROGRAM_SETTLE_MS + output * PROGRAM_MS_PER_OUTPUT_TOKEN,
      }),
    );
    const answer: ProgramAnswer = route.program.answer(ran);
    if (answer._tag === 'Refused') return yield* refused(answer.refusal, answer.message, undefined, answer.usage);
    return { answer, usage: answer.usage, account: environment.account };
  });

  const spokenText = Effect.fnUntraced(function* (route: AskRoute, selection: AskSelection, ask: FreshAsk) {
    if (route.path === 'program') {
      const { answer, usage, account } = yield* programAnswer(route, selection, ask.system, ask.input);
      const value = answer._tag === 'Text' ? answer.text : JSON.stringify(answer.object);
      return { value, usage, account } satisfies Spoken<string>;
    }
    const request = yield* requestOf(route, selection, ask.system, ask.stallMs);
    const response = yield* request.text({ prompt: ask.input, stallMs: ask.stallMs }).pipe(Effect.mapError(refusalOf));
    return { value: response.text, usage: LLMResponse.usage(response), account: request.signedAccount?.() } satisfies Spoken<string>;
  });

  const spokenObject = Effect.fnUntraced(function* (route: AskRoute, selection: AskSelection, ask: FreshAsk, schema: JsonSchema) {
    if (route.path === 'program') {
      const { answer, usage, account } = yield* programAnswer(route, selection, ask.system, ask.input, schema);
      const value =
        answer._tag === 'Object'
          ? answer.object
          : yield* parsedObject(answer._tag === 'Text' ? answer.text : '').pipe(
              Effect.mapError((failure) => refused(failure.refusal, failure.message, failure.failure, usage)),
            );
      return { value, usage, account } satisfies Spoken<unknown>;
    }
    const request = yield* requestOf(route, selection, ask.system, ask.stallMs);
    const answered = yield* request
      .object({ prompt: ask.input, schema: Schema.Unknown, jsonSchema: schema, stallMs: ask.stallMs })
      .pipe(Effect.mapError(refusalOf));
    return {
      value: answered.object,
      usage: LLMResponse.usage(answered.response),
      account: request.signedAccount?.(),
    } satisfies Spoken<unknown>;
  });

  const profileDecision = Effect.fnUntraced(function* (route: AskRoute, selection: AskSelection, request: DecisionRequest) {
    const option = optionOf(registry.current(), route.provider, selection.model);
    const needed = estimateThreadTokens(request);
    if (option?.capacity !== undefined && needed > option.capacity.context)
      return yield* refused(
        'ask-input-too-large',
        `The question needs about ${needed} tokens; ${selection.provider}:${selection.model} takes ${option.capacity.context}`,
      );
    const answer = yield* models
      .decide({ provider: route.provider, model: selection.model, account: selection.account, ownerId: OPERATOR_PRINCIPAL }, request)
      .pipe(
        Effect.mapError((failure) =>
          failure.failure !== undefined
            ? refusalOf(failure.failure)
            : failure.reason === 'malformed'
              ? refused('ask-unreadable-answer', failure.message, failure)
              : failure.reason === 'input-too-large'
                ? refused('ask-input-too-large', failure.message, failure)
                : failure.reason === 'no-model'
                  ? refused('ask-unanswerable', failure.message, failure)
                  : refused('ask-provider-failed', failure.message, failure),
        ),
      );
    return { value: answer, usage: answer.usage, account: selection.account ?? undefined } satisfies Spoken<DecisionAnswer>;
  });

  const objectDecision = Effect.fnUntraced(function* (route: AskRoute, selection: AskSelection, request: DecisionRequest) {
    const ask = textDecisionAsk(request);
    const answered = yield* spokenObject(route, selection, { system: ask.system, input: ask.prompt }, ask.jsonSchema);
    const verdicts = yield* decisionVerdicts(request, answered.value).pipe(
      Effect.mapError((failure: DecisionRefused) => refused('ask-unreadable-answer', failure.message, failure, answered.usage)),
    );
    const answer: DecisionAnswer = {
      model: new ModelIdentity({ provider: ProviderID.make(selection.provider), model: ModelID.make(selection.model) }),
      answers: verdicts,
      usage: answered.usage,
    };
    return { value: answer, usage: answered.usage, account: answered.account } satisfies Spoken<DecisionAnswer>;
  });

  const connected = Effect.fnUntraced(function* () {
    const held = yield* accounts.connected.pipe(
      Effect.mapError((failure) => refused('ask-provider-failed', 'the connected providers could not be read', failure)),
    );
    return held.providers;
  });

  const defaultFor = Effect.fn('ModelAsks.defaultFor')(function* (kind: AskKind, asker?: Asker) {
    const catalog = registry.current();
    const linked = yield* connected();
    const fit = (provider: string, model: string | null | undefined, rung: 'lowest' | string | null, account: string | null) => {
      if (model === null || model === undefined) return null;
      const option = optionOf(catalog, provider, model);
      const route = catalog.asks.route(provider, model);
      if (option === undefined || route === null || !catalog.asks.kinds(provider, model).includes(kind)) return null;
      if (!linked.has(provider) && !linked.has(route.provider)) return null;
      return { provider, model, reasoning: rung === 'lowest' ? lowestRung(option) : rung, account } satisfies AskSelection;
    };
    const lightOf = (provider: string, account: string | null) => {
      const light = catalog.models.registered(provider) ? catalog.models.named(provider).lightTextModel : undefined;
      return light === undefined ? null : fit(provider, light.model, light.rung, account);
    };
    if (kind === 'decision')
      for (const option of catalog.models.modelsByCapability('decision')) {
        const chosen = fit(option.provider, option.id, option.defaultReasoning, null);
        if (chosen !== null) return chosen;
      }
    if (asker !== undefined) {
      const own = catalog.models.registered(asker.provider) ? (asker.model ?? catalog.models.defaultTextModelId(asker.provider)) : null;
      const chosen = lightOf(asker.provider, asker.account) ?? fit(asker.provider, own, 'lowest', asker.account);
      if (chosen !== null) return chosen;
    }
    const saved = yield* defaults.saved;
    if (saved !== null) {
      const chosen = lightOf(saved.provider, null) ?? fit(saved.provider, saved.model, 'lowest', null);
      if (chosen !== null) return chosen;
    }
    for (const provider of catalog.models.providers) {
      const chosen = lightOf(provider.id, null);
      if (chosen !== null) return chosen;
    }
    return yield* refused(
      'ask-unanswerable',
      `Nothing connected here answers a ${kind} ask: no connected provider declares a light model that answers it`,
    );
  });

  const choose = Effect.fn('ModelAsks.choose')(function* (
    kind: AskKind,
    role: { readonly model: string; readonly reasoning: string },
    asker?: Asker,
  ) {
    if (role.model === '') return yield* defaultFor(kind, asker);
    const split = role.model.indexOf(':');
    const provider = split === -1 ? role.model : role.model.slice(0, split);
    const model = split === -1 ? '' : role.model.slice(split + 1);
    const option = optionOf(registry.current(), provider, model);
    if (option === undefined || !answers({ provider, model }, kind))
      return yield* refused('ask-unanswerable', `${role.model} cannot answer a ${kind} ask here`);
    const reasoning = role.reasoning !== '' ? role.reasoning : option.defaultReasoning;
    if (reasoning !== null && !option.reasoningOptions.some((rung) => rung.id === reasoning))
      return yield* refused('ask-unanswerable', `${role.model} offers no reasoning rung ${reasoning}`);
    return { provider, model, reasoning, account: null } satisfies AskSelection;
  });

  const capacity = Effect.fn('ModelAsks.capacity')(function* (selection: AskSelection, system: string) {
    const route = yield* routeOf(registry.current(), selection);
    if (route.path === 'program') {
      const option = optionOf(registry.current(), route.provider, selection.model);
      const output = plannedOutput(option);
      const context = option?.capacity?.context ?? 0;
      const input = Math.min(option?.capacity?.input ?? context, context - output) - estimateThreadTokens(system);
      if (input <= 0) return yield* refused('ask-input-too-large', `${selection.model} leaves no room for an input beside its answer`);
      return { input, output };
    }
    const request = yield* requestOf(route, selection, system);
    const served = yield* models
      .served(route.provider, selection.model)
      .pipe(Effect.mapError((failure) => refused('ask-unanswerable', failure.message, failure)));
    const input =
      served.capacity.context -
      request.plannedOutputTokens -
      estimateThreadTokens({ system: request.system, providerOptions: request.providerOptions });
    if (input <= 0) return yield* refused('ask-input-too-large', `${selection.model} leaves no room for an input beside its answer`);
    return { input, output: request.plannedOutputTokens };
  });

  const programRequest = (input: ModelRequestInput, route: ProgramRoute): ModelRequest => {
    const catalog = input.runId === undefined ? registry.current() : registry.forRun(input.runId);
    const model = input.model ?? catalog.models.defaultTextModelId(input.provider);
    const selection: AskSelection = { provider: input.provider, model, reasoning: input.reasoning ?? null, account: input.account ?? null };
    let account: string | undefined;
    const unsupported = Effect.fail(failureOf(refused('ask-unanswerable', `${input.provider} answers program asks with text only`)));
    const text = (call: ModelOneShotInput) =>
      observed(
        'text',
        'program',
        selection,
        Effect.map(
          programAnswer(route, selection, input.instructions ?? '', call.prompt ?? textOf(call.messages ?? [])),
          ({ answer, usage, account: signed }) => {
            account = signed;
            return { value: answer._tag === 'Text' ? answer.text : JSON.stringify(answer.object), usage, account: signed };
          },
        ),
      ).pipe(
        Effect.map((answered) => responseOf(answered.value, answered.usage)),
        Effect.mapError(failureOf),
      );
    return {
      system: input.instructions,
      rung: selection.reasoning,
      origin: new ModelIdentity({ provider: ProviderID.make(input.provider), model: ModelID.make(model) }),
      plannedOutputTokens: plannedOutput(optionOf(catalog, input.provider, model)),
      signedAccount: () => account,
      stream: () => Stream.fromEffect(unsupported),
      text,
      object: () => unsupported,
    };
  };

  return ModelAsks.of({
    answers,
    choose,
    defaultFor,
    capacity,
    text: (selection, ask) =>
      Effect.flatMap(routeOf(registry.current(), selection), (route) =>
        observed('text', route.path, selection, spokenText(route, selection, ask)),
      ).pipe(Effect.withSpan('ModelAsks.text')),
    object: (selection, ask) =>
      Effect.flatMap(routeOf(registry.current(), selection), (route) =>
        observed('object', route.path, selection, spokenObject(route, selection, ask, ask.schema)),
      ).pipe(Effect.withSpan('ModelAsks.object')),
    decide: (selection, request) =>
      Effect.flatMap(routeOf(registry.current(), selection), (route) => {
        const option = optionOf(registry.current(), route.provider, selection.model);
        const profiled = route.path === 'request' && option?.capabilities.includes('decision') === true;
        return observed(
          'decision',
          route.path,
          selection,
          profiled ? profileDecision(route, selection, request) : objectDecision(route, selection, request),
        );
      }).pipe(Effect.withSpan('ModelAsks.decide')),
    compaction: {
      request: (input) => {
        const catalog = input.runId === undefined ? registry.current() : registry.forRun(input.runId);
        const model = input.model ?? (catalog.models.registered(input.provider) ? catalog.models.defaultTextModelId(input.provider) : null);
        const route = model === null ? null : catalog.asks.route(input.provider, model);
        if (route === null || (route.provider === input.provider && route.path === 'request')) return models.request(input);
        return route.path === 'program' ? programRequest(input, route) : models.request({ ...input, provider: route.provider });
      },
      served: (provider, model, runId) => models.served(provider, model, runId),
      defaultModel: (provider, runId) => models.defaultModel(provider, runId),
    },
  });
});

export const modelAsksLayer = Layer.effect(ModelAsks, makeModelAsks);
