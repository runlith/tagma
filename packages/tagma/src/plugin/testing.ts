import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Fiber, Layer, Result, Schema, type Scope, Stream } from 'effect';
import { HttpClient, type HttpClientRequest, HttpClientResponse } from 'effect/http';
import { LlmClient, llmClientLayer } from '@runlith/llm/route/client';
import { doorExecutorLayer } from '@runlith/llm/route/executor';
import { LLMError } from '@runlith/llm/schema/errors';
import { LLMRequest, Message } from '@runlith/llm/schema/messages';
import type { StoredCredential } from '@runlith/llm/oauth/credential';
import { deviceAuthorization, deviceGrantApproval } from '@runlith/llm/oauth/flows/deviceGrant';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import type { GeneratedImage, ImageRequest } from '@runlith/llm/profiles/images';
import { type McpCaller, mcpCallerMeta } from '@runlith/mcp/caller';
import type { McpServedResult } from '@runlith/mcp/server';
import { type AnyProvider, speechCatalog } from '@runlith/speech/engine/catalog';
import type { SpeechHost } from '@runlith/speech/engine/SpeechSources';
import type { Recorded } from '@runlith/speech/protocol/adapter';
import { type ScriptedLink, scriptedTransport } from '@runlith/speech/testing/ScriptedTransport';
import type { RecognitionModel, SynthesisModel } from '@runlith/speech/wire/capabilities';
import type { FileEvent } from '@runlith/speech/wire/events';
import type { RecognitionRequest, SynthesisRequest } from '@runlith/speech/wire/requests';
import { declare } from '../adapter/declaration';
import { importProviders } from '../adapter/loader';
import { sdkHost } from '../adapter/sdkHost';
import type { AdapterHost, WireProvider } from '../adapter/provider';
import { MANIFEST, manifestOf } from './describe.js';
import type { OperationId, PluginDefinition, TagmaClient } from './plugin.js';
import {
  type ActionInput,
  type BuildStepInput,
  type EndingInput,
  handlerTools,
  type HookInput,
  type NotificationInput,
  PROJECTS_META_KEY,
  TAGMA_REASONS,
  type TickInput,
} from './protocol.js';
import { servingOf } from './serving.js';

export type TestedAnswer = {
  readonly text: string;
  readonly isError: boolean;
  readonly structured?: Readonly<Record<string, unknown>>;
};

export type TagmaDouble = (operation: OperationId, input: unknown, project: number | null) => Promise<unknown>;

export type TestPluginOptions = {
  readonly options?: Readonly<Record<string, string>>;
  readonly data?: string;
  readonly projects?: readonly number[];
  readonly tagma?: TagmaDouble;
};

export type TestedPlugin = {
  readonly manifest: ReturnType<typeof manifestOf>;
  readonly call: (tool: string, input?: Readonly<Record<string, unknown>>, caller?: McpCaller) => Promise<TestedAnswer>;
  readonly tick: (schedule: string, tick?: Partial<Omit<TickInput, 'name'>>) => Promise<TestedAnswer>;
  readonly end: (ending: EndingInput, project?: number | null) => Promise<TestedAnswer>;
  readonly notify: (answer: NotificationInput) => Promise<TestedAnswer>;
  readonly build: (step: string, input: BuildStepInput, project?: number | null) => Promise<TestedAnswer>;
  readonly act: (
    action: string,
    project?: number | null,
    from?: { readonly threadId?: string; readonly args?: string },
  ) => Promise<TestedAnswer>;
  readonly check: (hook: string, event: HookInput, project?: number | null) => Promise<TestedAnswer>;
  readonly read: (uri: string, caller?: McpCaller) => Promise<TestedAnswer>;
  readonly changed: readonly string[];
};

const AGENT: McpCaller = { kind: 'agent', projectId: 1, agentId: 'tester', ownerId: 'tester', thread: null };

const unreachable: TagmaDouble = (operation) => Promise.reject(new Error(`${operation}: this test gave testPlugin no tagma double`));

const testedOf = (result: McpServedResult): TestedAnswer =>
  result.structuredContent === undefined
    ? { text: result.text, isError: result.isError === true }
    : { text: result.text, isError: result.isError === true, structured: result.structuredContent };

export const testPlugin = (definition: PluginDefinition, given: TestPluginOptions = {}): TestedPlugin => {
  const double = given.tagma ?? unreachable;
  const client = (project: number | null): TagmaClient => ({
    op: (id, input) => double(id, input, project) as never,
    in: (other) => client(other),
  });
  const changed: string[] = [];
  let data = given.data;
  const serving = servingOf(definition, {
    get data() {
      data ??= mkdtempSync(join(tmpdir(), `${definition.id}-data-`));
      return data;
    },
    options: Object.fromEntries((definition.options ?? []).map((option) => [option.key, given.options?.[option.key] ?? option.default])),
    client,
    log: (text) => process.stderr.write(`${text}\n`),
    changed: (uri) => changed.push(uri),
  });
  const meta = (caller: McpCaller) => ({ ...mcpCallerMeta(caller), [PROJECTS_META_KEY]: given.projects ?? [] });
  const call = async (tool: string, input: Readonly<Record<string, unknown>>, caller: McpCaller): Promise<TestedAnswer> =>
    testedOf(await serving.call(tool, input, meta(caller), new AbortController().signal));
  const tagma = (projectId: number | null, reason: string): McpCaller => ({ kind: 'tagma', projectId, reason });
  return {
    manifest: manifestOf(serving.description),
    call: (tool, input = {}, caller = AGENT) => call(tool, input, caller),
    tick: (schedule, tick = {}) => {
      const now = Date.now();
      return call(
        handlerTools.schedule(schedule),
        { name: schedule, scheduledAt: tick.scheduledAt ?? now, startedAt: tick.startedAt ?? now, skipped: tick.skipped ?? 0 },
        tagma(null, TAGMA_REASONS.schedule),
      );
    },
    end: (ending, project = AGENT.projectId) => call(handlerTools.ended, ending, tagma(project, TAGMA_REASONS.ended)),
    notify: (answer) => call(handlerTools.notification, answer, tagma(null, TAGMA_REASONS.notification)),
    build: (step, input, project = AGENT.projectId) => call(handlerTools.build(step), input, tagma(project, TAGMA_REASONS.build)),
    act: (action, project = AGENT.projectId, { threadId, args = '' }: { readonly threadId?: string; readonly args?: string } = {}) =>
      call(handlerTools.action(action), { args } satisfies ActionInput, {
        kind: 'operator',
        projectId: project,
        view: `action:${action}`,
        ...(threadId === undefined ? {} : { threadId }),
      }),
    check: (hook, event, project = AGENT.projectId) => call(handlerTools.hook(hook), event, tagma(project, TAGMA_REASONS.hook)),
    read: async (uri, caller = AGENT) => {
      const read = await serving.read(uri, meta(caller), new AbortController().signal);
      return 'refused' in read ? { text: read.refused, isError: true } : { text: read.text, isError: false };
    },
    changed,
  };
};

export type SignInFixture = {
  readonly kind: 'loopback' | 'paste' | 'key' | 'device';
  readonly input: string;
  readonly openBrowser?: (authorizeUrl: string) => void;
};

export type ModelsPhase = 'sign-in' | 'model' | 'failure' | 'image';

export type ModelsFixture = {
  readonly host: AdapterHost;
  readonly provider: string;
  readonly model?: string;
  readonly signIn?: SignInFixture;
  readonly key?: string;
  readonly expectedText: string;
  readonly respond: (request: HttpClientRequest.HttpClientRequest, phase: ModelsPhase) => Response;
};

export type SpeechFixture = {
  readonly provider: string;
  readonly model?: string;
  readonly credential?: unknown;
  readonly respond?: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly serve?: (link: ScriptedLink) => Effect.Effect<void>;
};

export type ConformanceFixture = { readonly models?: ModelsFixture; readonly speech?: SpeechFixture };

export type ModelsResult = {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly failure: LLMError;
  readonly image: GeneratedImage | null;
};

export type SpeechResult = {
  readonly provider: string;
  readonly model: string;
  readonly heard: readonly FileEvent[];
  readonly spokenSamples: number;
};

export type ConformanceResult = { readonly models?: ModelsResult; readonly speech?: SpeechResult };

const signIn = Effect.fn('conformance.signIn')(function* (
  provider: WireProvider,
  fixture: SignInFixture,
): Effect.fn.Return<StoredCredential, unknown, HttpClient.HttpClient> {
  const accounts = provider.accounts;
  assert(accounts !== undefined, `Provider ${provider.id} declares no subscription accounts`);
  const method = accounts.signIns.find((method) => method.kind === fixture.kind);
  assert(method !== undefined, `Provider ${provider.id} declares no ${fixture.kind} sign-in`);
  const open =
    fixture.openBrowser ??
    (() => {
      throw new Error('Supply openBrowser to complete the local sign-in');
    });
  const credential =
    method.kind === 'loopback'
      ? yield* method.run(open)
      : method.kind === 'paste'
        ? yield* Effect.gen(function* () {
            const challenge = yield* method.begin();
            open(challenge.authorizeUrl);
            return yield* challenge.complete(fixture.input);
          })
        : method.kind === 'key'
          ? yield* method.store(fixture.input)
          : yield* Effect.gen(function* () {
              const challenge = yield* deviceAuthorization(method.vendor);
              open(challenge.verificationUriComplete ?? challenge.verificationUri);
              return yield* method.store(yield* deviceGrantApproval(method.vendor, challenge));
            });
  return yield* Schema.decodeUnknownEffect(accounts.credential)(credential);
});

const drawn = async (
  provider: WireProvider,
  credentials: ModelCredentials,
  client: HttpClient.HttpClient,
  sent: () => number,
): Promise<GeneratedImage | null> => {
  const [model, spec] = Object.entries(provider.imageModels ?? {})[0] ?? [];
  if (model === undefined || spec === undefined) return null;
  assert(provider.images !== undefined, `Provider ${provider.id} declares image models without an image profile`);
  const profile = provider.images;
  const draw = (request: Partial<ImageRequest>) =>
    profile
      .generate({ ownerId: 'contract', model, credentials }, { model, prompt: 'contract', images: [], transparent: false, ...request })
      .pipe(Effect.provide(doorExecutorLayer(client)));
  const answer = await Effect.runPromise(draw({}));
  const image = answer.images[0];
  assert(image !== undefined && image.bytes.byteLength > 0, 'The stub image response did not reach the consumer');
  assert(image.mediaType.startsWith('image/'), `The image answer names ${image.mediaType}, not a picture type`);
  const before = sent();
  const beyond = await Effect.runPromise(Effect.result(draw({ images: Array.from({ length: spec.inputs + 1 }, () => image) })));
  assert(Result.isFailure(beyond) && beyond.failure instanceof LLMError, `${model} accepted more input images than it declares`);
  assert.equal(sent(), before, `${model} sent a request beyond what it declares instead of refusing it first`);
  return image;
};

const conformModels = async (models: unknown, fixture: ModelsFixture): Promise<ModelsResult> => {
  const declared = declare(models, fixture.host);
  const provider = declared.providers.find((provider) => provider.id === fixture.provider);
  assert(provider?.kind === 'wire', `The kit needs a declared wire provider: ${fixture.provider}`);
  const modelId = fixture.model ?? provider.defaultTextModel;
  assert(provider.models[modelId] !== undefined, `Provider ${provider.id} declares no model ${modelId}`);
  let phase: ModelsPhase = 'sign-in';
  let sent = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      sent += 1;
      return HttpClientResponse.fromWeb(request, fixture.respond(request, phase));
    }),
  );
  const credential =
    fixture.signIn === undefined
      ? undefined
      : await Effect.runPromise(signIn(provider, fixture.signIn).pipe(Effect.provideService(HttpClient.HttpClient, client)));
  if (provider.auth === 'oauth') assert(credential !== undefined, 'Exercise a declared sign-in for a subscription provider');
  if (provider.auth === 'api-key') assert(fixture.key !== undefined, 'Supply a local API key fixture');
  const credentials: ModelCredentials = {
    apiKey: async () => fixture.key ?? fixture.signIn?.input ?? '',
    accessToken: async () => {
      assert(credential !== undefined);
      return credential.accessToken;
    },
    credential: async () => credential,
  };
  const invoke = Effect.gen(function* () {
    const model = yield* provider.profile.model({ ownerId: 'contract', model: modelId, credentials });
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('contract')],
      tools: [],
      providerOptions: provider.profile.options({
        model: modelId,
        rung: provider.models[modelId]!.defaultReasoning,
        adaptive: false,
        reasoningOutput: false,
        outputTokens: 32,
        switches: {},
      }),
    });
    return yield* LlmClient.use((client) => client.generate(request));
  });
  const layer = llmClientLayer.pipe(Layer.provide(doorExecutorLayer(client)));
  phase = 'model';
  const answer = await Effect.runPromise(invoke.pipe(Effect.provide(layer)));
  assert.equal(answer.text, fixture.expectedText, 'The stub model response did not reach the consumer');
  phase = 'failure';
  const refused = await Effect.runPromise(Effect.result(invoke).pipe(Effect.provide(layer)));
  assert(Result.isFailure(refused), 'The failing stub model call answered success');
  assert(refused.failure instanceof LLMError, 'The adapter failure is not the host LLMError class');
  phase = 'image';
  const image = await drawn(provider, credentials, client, () => sent);
  return { provider: provider.id, model: modelId, text: answer.text, failure: refused.failure, image };
};

const SILENCE_RATE = 16_000;

const recognizing = Effect.fnUntraced(function* (
  provider: AnyProvider<SpeechHost>,
  model: RecognitionModel,
  credential: unknown,
): Effect.fn.Return<readonly FileEvent[], unknown, Scope.Scope | SpeechHost> {
  const recognizer = provider.recognizer!;
  const capabilities = model.recognition;
  const request: RecognitionRequest = {
    turns: capabilities.kind === 'stream' ? capabilities.turns[0]! : capabilities.kind === 'batch' ? 'client' : 'none',
    rate: capabilities.kind === 'file' ? SILENCE_RATE : capabilities.rates[0]!,
    languages: [],
    detect: false,
    speakers: false,
    terms: [],
    tuning: {},
  };
  const format = { rate: request.rate, channels: 1 };
  const pcm = new Int16Array(request.rate / 10);
  if (capabilities.kind === 'batch') return yield* Stream.runCollect(recognizer.batch!(model, { format, pcm }, request, credential));
  if (capabilities.kind === 'file') {
    const bytes = new Uint8Array(64);
    const recorded: Recorded = {
      mime: capabilities.containers[0]!,
      bytes: Stream.make(bytes),
      size: bytes.byteLength,
      format,
      durationMs: 100,
      reference: 'conformance',
    };
    return yield* Stream.runCollect(recognizer.file!(model, recorded, request, credential));
  }
  const connection = yield* recognizer.stream!(model, request, credential);
  const events = yield* Effect.forkScoped(Stream.runCollect(connection.events));
  yield* connection.send(pcm);
  yield* connection.finish;
  return yield* Fiber.join(events);
});

const speaking = Effect.fnUntraced(function* (
  provider: AnyProvider<SpeechHost>,
  model: SynthesisModel,
  credential: unknown,
): Effect.fn.Return<number, unknown, Scope.Scope | SpeechHost> {
  const capabilities = model.synthesis;
  const request: SynthesisRequest = {
    voice: capabilities.voices[0]!.id,
    rate: capabilities.rates[0]!,
    language: capabilities.needsLanguage ? capabilities.languages[0] : undefined,
    timestamps: false,
  };
  const synthesis = yield* provider.synthesizer!.open(model, request, credential);
  const spoken = yield* Effect.forkScoped(Stream.runCollect(synthesis.audio));
  yield* synthesis.say('contract');
  yield* synthesis.end;
  return (yield* Fiber.join(spoken)).reduce((samples, part) => samples + (part._tag === 'Audio' ? part.pcm.length : 0), 0);
});

const conformSpeech = async (owner: string, speech: readonly AnyProvider<SpeechHost>[], fixture: SpeechFixture): Promise<SpeechResult> => {
  const { faults } = speechCatalog([{ owner, providers: speech }]);
  assert.equal(faults.length, 0, faults.map((fault) => `${fault.provider}: ${fault.reason}`).join('\n'));
  const provider = speech.find((provider) => provider.id === fixture.provider);
  assert(provider !== undefined, `The folder declares no speech provider ${fixture.provider}`);
  const model = [...(provider.recognizer?.models ?? []), ...(provider.synthesizer?.models ?? [])].find(
    (model) => fixture.model === undefined || model.id === fixture.model,
  );
  assert(model !== undefined, `Provider ${provider.id} declares no model ${fixture.model ?? ''}`);
  const form = provider.credential;
  const credential = form._tag === 'none' ? form.value : Schema.decodeUnknownSync(form.schema)(fixture.credential);
  const client = HttpClient.make((request) =>
    fixture.respond === undefined
      ? Effect.die(new Error(`The speech stub gave no respond for ${request.url}`))
      : Effect.sync(() => HttpClientResponse.fromWeb(request, fixture.respond!(request))),
  );
  const run = Effect.gen(function* () {
    const transport = yield* scriptedTransport;
    if (fixture.serve !== undefined) yield* Effect.forkScoped(Effect.flatMap(transport.next, fixture.serve));
    const host = Layer.merge(transport.layer, Layer.succeed(HttpClient.HttpClient, client));
    const drive =
      'recognition' in model
        ? Effect.map(recognizing(provider, model, credential), (heard) => ({ heard, spokenSamples: 0 }))
        : Effect.map(speaking(provider, model, credential), (spokenSamples) => ({ heard: [], spokenSamples }));
    return yield* drive.pipe(Effect.provide(host));
  });
  const done = await Effect.runPromise(Effect.scoped(run));
  if ('recognition' in model) assert(done.heard.length > 0, `Provider ${provider.id} heard nothing from the stub`);
  else assert(done.spokenSamples > 0, `Provider ${provider.id} spoke nothing from the stub`);
  return { provider: provider.id, model: model.id, ...done };
};

export const runConformance = async (directory: string, fixture: ConformanceFixture): Promise<ConformanceResult> => {
  const real = await realpath(directory);
  const { providers } = JSON.parse(await readFile(join(real, MANIFEST), 'utf8')) as {
    readonly providers?: { readonly entry: string };
  };
  assert(providers !== undefined, `${MANIFEST} declares no provider part: build the plugin first`);
  const imported = await importProviders(real, await sdkHost(), ['--no-install']);
  assert(imported.models === undefined || fixture.models !== undefined, 'The folder declares models: give the fixture a models stub');
  assert(imported.speech === undefined || fixture.speech !== undefined, 'The folder declares speech: give the fixture a speech stub');
  return {
    ...(imported.models === undefined || fixture.models === undefined
      ? {}
      : { models: await conformModels(imported.models, fixture.models) }),
    ...(imported.speech === undefined || fixture.speech === undefined
      ? {}
      : { speech: await conformSpeech(imported.id, imported.speech, fixture.speech) }),
  };
};
