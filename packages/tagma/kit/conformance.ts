import { strict as assert } from 'node:assert';
import { Effect, Layer, Result, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { LlmClient, llmClientLayer } from '@runlith/llm/route/client';
import { doorExecutorLayer } from '@runlith/llm/route/executor';
import { LLMError } from '@runlith/llm/schema/errors';
import { LLMRequest, Message } from '@runlith/llm/schema/messages';
import type { StoredCredential } from '@runlith/llm/oauth/credential';
import { deviceAuthorization, deviceGrantApproval } from '@runlith/llm/oauth/flows/deviceGrant';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import type { GeneratedImage, ImageRequest } from '@runlith/llm/profiles/images';
import type { AdapterHost, WireProvider } from '../src/adapter/provider';
import { declare } from '../src/adapter/declaration';
import { host } from './host.generated';
import { importProviders } from '../src/adapter/loader';

export type SignInFixture = {
  readonly kind: 'loopback' | 'paste' | 'key' | 'device';
  readonly input: string;
  readonly openBrowser?: (authorizeUrl: string) => void;
};

export type ConformanceFixture = {
  readonly host: AdapterHost;
  readonly provider: string;
  readonly model?: string;
  readonly signIn?: SignInFixture;
  readonly key?: string;
  readonly expectedText: string;
  readonly respond: (request: HttpClientRequest.HttpClientRequest, phase: ConformancePhase) => Response;
};

export type ConformancePhase = 'sign-in' | 'model' | 'failure' | 'image';

export type ConformanceResult = {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly failure: LLMError;
  readonly image: GeneratedImage | null;
};

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

export const runConformance = async (directory: string, fixture: ConformanceFixture): Promise<ConformanceResult> => {
  const declared = declare((await importProviders(directory, host)).models, fixture.host);
  const provider = declared.providers.find((provider) => provider.id === fixture.provider);
  assert(provider?.kind === 'wire', `The kit needs a declared wire provider: ${fixture.provider}`);
  const modelId = fixture.model ?? provider.defaultTextModel;
  assert(provider.models[modelId] !== undefined, `Provider ${provider.id} declares no model ${modelId}`);
  let phase: ConformancePhase = 'sign-in';
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
