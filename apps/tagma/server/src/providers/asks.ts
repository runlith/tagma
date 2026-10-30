import { ActivityLog } from '@runlith/activity/log';
import type { ModelRequest } from '@runlith/agent/modelPort';
import { estimateThreadTokens } from '@runlith/agent/thread/compaction/measurement';
import { decodeJsonAnswer } from '@runlith/llm/call';
import { DecisionRefused, type DecisionAnswer, type DecisionRequest } from '@runlith/llm/decision';
import { lowestReasoning, type ModelOption } from '@runlith/llm/models/catalog';
import { LLMResponse, type Usage } from '@runlith/llm/schema/events';
import { ModelID, ProviderID, type JsonSchema } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { decisionVerdicts, textDecisionAsk } from '@runlith/llm/textDecision';
import type { AskKind, ModelCapacity } from '@runlith/llm/models/description';
import type { ProgramAnswer } from '@runlith/tagma/adapter/provider';
import { Effect, Layer, Schema, Semaphore } from 'effect';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { thisMachine } from '../platform/contract/service/capacity.js';
import { askActivity } from './askActivity.js';
import { ProviderAccounts } from './contract/service/accounts.js';
import { ModelAccess } from './contract/service/access.js';
import {
  AskPrograms,
  AskRefused,
  askFailure,
  DefaultSelection,
  ModelAsks,
  type Answered,
  type AskCapacity,
  type Asker,
  type AskSelection,
  type FreshAsk,
} from './contract/service/asks.js';
import { HarnessAccounts } from './contract/service/harness.js';
import { AdapterInstalls } from './contract/service/adapters.js';
import type { AskPath, AskRefusal } from './contract/wire/asks.js';
import { ProviderRegistry, type AskRoute, type ProviderCatalog } from './contract/service/registry.js';

const PROGRAM_OUTPUT_TOKENS = 8_192;
const PROGRAM_SETTLE_MS = 30_000;
const PROGRAM_MS_PER_OUTPUT_TOKEN = 25;

type ProgramRoute = Extract<AskRoute, { readonly path: 'program' }>;

type Spoken<A> = { readonly value: A; readonly usage: Usage | undefined; readonly account: string | undefined };

const refused = (refusal: AskRefusal, message: string, failure?: unknown, usage?: Usage) =>
  new AskRefused({ refusal, message, failure, usage });

const optionOf = (catalog: ProviderCatalog, provider: string, model: string): ModelOption | undefined =>
  catalog.models.registered(provider) ? catalog.models.modelsOf(provider).find((option) => option.id === model) : undefined;

const objectInstruction = (system: string, schema: JsonSchema) =>
  `${system}\n\nAnswer with one JSON value that matches this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`;

const parsedObject = (text: string): Effect.Effect<unknown, AskRefused> => {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/u.exec(text.trim());
  return Effect.try({
    try: () => JSON.parse(fenced === null ? text.trim() : fenced[1]!) as unknown,
    catch: (cause) => refused('ask-unreadable-answer', `The answer is not one JSON value: ${String(cause)}`),
  });
};

const budgetOf = (selection: AskSelection, context: number, input: number | undefined, output: number, system: number) => {
  const room = Math.min(input ?? context, context - output) - system;
  return room > 0
    ? Effect.succeed<AskCapacity>({ input: room, output })
    : Effect.fail(refused('ask-input-too-large', `${selection.model} leaves no room for an input beside its answer`));
};

export const programOutput = (capacity: ModelCapacity | undefined): number =>
  Math.min(capacity?.output ?? PROGRAM_OUTPUT_TOKENS, PROGRAM_OUTPUT_TOKENS);

const programBudget = (catalog: ProviderCatalog, route: ProgramRoute, selection: AskSelection, system: string) => {
  const capacity = optionOf(catalog, route.provider, selection.model)?.capacity;
  if (capacity === undefined)
    return Effect.fail(refused('ask-unanswerable', `${selection.provider}:${selection.model} declares no context window to ask within`));
  return budgetOf(selection, capacity.context, capacity.input, programOutput(capacity), estimateThreadTokens(system));
};

export const makeModelAsks = Effect.gen(function* () {
  const models = yield* ModelAccess;
  const registry = yield* ProviderRegistry;
  const accounts = yield* ProviderAccounts;
  const harnessAccounts = yield* HarnessAccounts;
  const programs = yield* AskPrograms;
  const installs = yield* AdapterInstalls;
  const defaults = yield* DefaultSelection;
  const log = yield* ActivityLog;
  const lanes = new Map<string, Semaphore.Semaphore>();
  const lanesPerProvider = Math.max(1, Math.floor(thisMachine().parallelism / 4));

  const laneOf = (provider: string): Semaphore.Semaphore => {
    const held = lanes.get(provider);
    if (held !== undefined) return held;
    const made = Semaphore.makeUnsafe(lanesPerProvider);
    lanes.set(provider, made);
    return made;
  };

  const catalogOf = (ask?: { readonly runId?: string }) => (ask?.runId === undefined ? registry.current() : registry.forRun(ask.runId));

  const routeOf = (catalog: ProviderCatalog, selection: AskSelection) => {
    const route = catalog.asks.route(selection.provider, selection.model);
    return route === null
      ? Effect.fail(
          refused('ask-unanswerable', `${selection.provider}:${selection.model} answers no asks: its provider declares no ask path`),
        )
      : Effect.succeed(route);
  };

  const observed = <A>(
    kind: AskKind,
    path: AskPath,
    selection: AskSelection,
    work: Effect.Effect<Spoken<A>, AskRefused>,
  ): Effect.Effect<Answered<A>, AskRefused> =>
    Effect.provideService(
      askActivity(
        { kind, path, provider: selection.provider, model: selection.model, rung: selection.reasoning },
        Effect.map(work, (spoken) => ({ value: spoken.value, path, selection, usage: spoken.usage, account: spoken.account })),
      ),
      ActivityLog,
      log,
    );

  const requestOf = (route: AskRoute, selection: AskSelection, system: string, ask?: FreshAsk): Effect.Effect<ModelRequest, AskRefused> => {
    const request = models.request({
      ownerId: OPERATOR_PRINCIPAL,
      runId: ask?.runId,
      provider: route.provider,
      model: selection.model,
      reasoning: selection.reasoning,
      account: selection.account ?? undefined,
      instructions: system,
      cache: 'none',
      reasoningOutput: false,
      stallMs: ask?.stallMs,
    });
    return request.refusal === undefined ? Effect.succeed(request) : Effect.fail(askFailure(request.refusal));
  };

  const environmentOf = Effect.fnUntraced(function* (catalog: ProviderCatalog, route: ProgramRoute, account: string | null) {
    const registration = catalog.harnesses.find((provider) => provider.id === route.provider);
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

  const heldRoute = Effect.fnUntraced(function* (catalog: ProviderCatalog, route: ProgramRoute, selection: AskSelection) {
    let held = { catalog, route };
    while (!(yield* installs.hold(held.route.package))) {
      const current = registry.current();
      const next = yield* routeOf(current, selection);
      if (next.path !== 'program')
        return yield* refused('ask-unanswerable', `${selection.provider}:${selection.model} no longer answers by a program`);
      held = { catalog: current, route: next };
    }
    return held;
  });

  const programAnswer = Effect.fnUntraced(function* (
    given: ProviderCatalog,
    routed: ProgramRoute,
    selection: AskSelection,
    ask: FreshAsk,
    schema?: JsonSchema,
  ) {
    const { catalog, route } = yield* heldRoute(given, routed, selection);
    const native = schema !== undefined && !('runner' in route.program) && route.program.schemas;
    const system = schema === undefined || native ? ask.system : objectInstruction(ask.system, schema);
    const budget = yield* programBudget(catalog, route, selection, system);
    if (estimateThreadTokens(ask.input) > budget.input)
      return yield* refused('ask-input-too-large', `The input takes more than ${selection.model} reads beside its answer`);
    const environment = yield* environmentOf(catalog, route, selection.account);
    const ran = yield* laneOf(route.provider)
      .withPermits(1)(
        programs.run({
          program: route.program,
          ask: { model: selection.model, rung: selection.reasoning, system, schema: native ? schema : undefined },
          entries: environment.entries,
          input: ask.input,
          deadlineMs: PROGRAM_SETTLE_MS + budget.output * PROGRAM_MS_PER_OUTPUT_TOKEN,
        }),
      )
      .pipe(Effect.mapError((failure) => refused('ask-provider-failed', failure.message, failure)));
    const answer: ProgramAnswer = route.program.answer(ran);
    if (answer._tag === 'Refused') return yield* refused(answer.refusal, answer.message, undefined, answer.usage);
    return { answer, usage: answer.usage, account: environment.account };
  }, Effect.scoped);

  const spokenText = Effect.fnUntraced(function* (catalog: ProviderCatalog, route: AskRoute, selection: AskSelection, ask: FreshAsk) {
    if (route.path === 'program') {
      const { answer, usage, account } = yield* programAnswer(catalog, route, selection, ask);
      const value = answer._tag === 'Text' ? answer.text : JSON.stringify(answer.object);
      return { value, usage, account } satisfies Spoken<string>;
    }
    const request = yield* requestOf(route, selection, ask.system, ask);
    const response = yield* request.text({ prompt: ask.input, stallMs: ask.stallMs }).pipe(Effect.mapError(askFailure));
    return { value: response.text, usage: LLMResponse.usage(response), account: request.signedAccount?.() } satisfies Spoken<string>;
  });

  const spokenObject = Effect.fnUntraced(function* (
    catalog: ProviderCatalog,
    route: AskRoute,
    selection: AskSelection,
    ask: FreshAsk,
    schema: JsonSchema,
  ) {
    if (route.path === 'program') {
      const { answer, usage, account } = yield* programAnswer(catalog, route, selection, ask, schema);
      const given =
        answer._tag === 'Object'
          ? answer.object
          : yield* parsedObject(answer._tag === 'Text' ? answer.text : '').pipe(
              Effect.mapError((failure) => refused(failure.refusal, failure.message, failure.failure, usage)),
            );
      const value = yield* decodeJsonAnswer(schema)(given).pipe(
        Effect.mapError((issue) =>
          refused('ask-unreadable-answer', `The answer does not match the requested shape: ${issue.message}`, issue, usage),
        ),
      );
      return { value, usage, account } satisfies Spoken<unknown>;
    }
    const request = yield* requestOf(route, selection, ask.system, ask);
    const answered = yield* request
      .object({ prompt: ask.input, schema: Schema.Unknown, jsonSchema: schema, stallMs: ask.stallMs })
      .pipe(Effect.mapError(askFailure));
    return {
      value: answered.object,
      usage: LLMResponse.usage(answered.response),
      account: request.signedAccount?.(),
    } satisfies Spoken<unknown>;
  });

  const profileDecision = Effect.fnUntraced(function* (
    option: ModelOption,
    route: AskRoute,
    selection: AskSelection,
    request: DecisionRequest,
  ) {
    const needed = estimateThreadTokens(request);
    const room = option.capacity === undefined ? undefined : (option.capacity.input ?? option.capacity.context);
    if (room !== undefined && needed > room)
      return yield* refused(
        'ask-input-too-large',
        `The question needs about ${needed} tokens; ${selection.provider}:${selection.model} takes ${room}`,
      );
    const answer = yield* models
      .decide({ provider: route.provider, model: selection.model, account: selection.account, ownerId: OPERATOR_PRINCIPAL }, request)
      .pipe(
        Effect.mapError((failure) =>
          failure.failure !== undefined
            ? askFailure(failure.failure)
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

  const objectDecision = Effect.fnUntraced(function* (
    catalog: ProviderCatalog,
    route: AskRoute,
    selection: AskSelection,
    request: DecisionRequest,
  ) {
    const ask = textDecisionAsk(request);
    const answered = yield* spokenObject(catalog, route, selection, { system: ask.system, input: ask.prompt }, ask.jsonSchema);
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

  const defaultFor = Effect.fn('ModelAsks.defaultFor')(function* (kind: AskKind, asker?: Asker) {
    const catalog = registry.current();
    const linked = (yield* Effect.orDie(accounts.connected)).providers;
    const fit = (provider: string, model: string | null | undefined, rung: 'lowest' | string | null, account: string | null) => {
      if (model === null || model === undefined) return null;
      const option = optionOf(catalog, provider, model);
      const route = catalog.asks.route(provider, model);
      if (option === undefined || route === null || !catalog.asks.answers(provider, model, kind)) return null;
      if (!linked.has(provider) && !linked.has(route.provider)) return null;
      return { provider, model, reasoning: rung === 'lowest' ? lowestReasoning(option) : rung, account } satisfies AskSelection;
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

  return ModelAsks.of({
    resolve: (selection) => {
      const request = models.request({
        ownerId: OPERATOR_PRINCIPAL,
        provider: selection.provider,
        model: selection.model,
        reasoning: selection.reasoning,
      });
      return { origin: request.origin, reasoning: request.rung ?? null };
    },
    choose: Effect.fn('ModelAsks.choose')(function* (kind, role, asker) {
      if (role === null) return yield* defaultFor(kind, asker);
      const named = `${role.provider}:${role.model}`;
      const catalog = registry.current();
      const option = optionOf(catalog, role.provider, role.model);
      if (option === undefined || !catalog.asks.answers(role.provider, role.model, kind))
        return yield* refused('ask-unanswerable', `${named} cannot answer a ${kind} ask here`);
      const reasoning = role.reasoning ?? option.defaultReasoning;
      if (reasoning !== null && !option.reasoningOptions.some((rung) => rung.id === reasoning))
        return yield* refused('ask-unanswerable', `${named} offers no reasoning rung ${reasoning}`);
      return { provider: role.provider, model: role.model, reasoning, account: null };
    }),

    capacity: Effect.fn('ModelAsks.capacity')(function* (selection, system) {
      const catalog = registry.current();
      const route = yield* routeOf(catalog, selection);
      if (route.path === 'program') return yield* programBudget(catalog, route, selection, system);
      const request = yield* requestOf(route, selection, system);
      const served = yield* models
        .served(route.provider, selection.model)
        .pipe(Effect.mapError((failure) => refused('ask-unanswerable', failure.message, failure)));
      const overhead = estimateThreadTokens({ system: request.system, providerOptions: request.providerOptions });
      return yield* budgetOf(selection, served.capacity.context, served.capacity.input, request.plannedOutputTokens, overhead);
    }),

    text: Effect.fn('ModelAsks.text')(function* (selection, ask) {
      const catalog = catalogOf(ask);
      const route = yield* routeOf(catalog, selection);
      return yield* observed('text', route.path, selection, spokenText(catalog, route, selection, ask));
    }),

    decide: Effect.fn('ModelAsks.decide')(function* (selection, request) {
      const catalog = registry.current();
      const route = yield* routeOf(catalog, selection);
      const option = optionOf(catalog, route.provider, selection.model);
      const work =
        route.path === 'request' && option !== undefined && option.capabilities.includes('decision')
          ? profileDecision(option, route, selection, request)
          : objectDecision(catalog, route, selection, request);
      return yield* observed('decision', route.path, selection, work);
    }),
  });
});

export const modelAsksLayer = Layer.effect(ModelAsks, makeModelAsks);
