import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { runConformance } from '@runlith/tagma/adapter/conformance';
import { LLMError } from '@runlith/llm/schema/errors';
import type { WireProvider } from '@runlith/tagma/adapter/provider';
import { Effect, Layer } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { LlmClient, llmClientLayer } from '@runlith/llm/route/client';
import { doorExecutorLayer } from '@runlith/llm/route/executor';
import { LLMRequest, Message } from '@runlith/llm/schema/messages';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { HOST_MODULES } from '../hostModules.generated.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { makeMachineAdapters } from '../../providers/adapters/installs.js';
import { AdapterPlaces, BuiltinAdapters, ProviderRegistry } from '../../providers/contract/service/registry.js';
import { registryLayer } from '../../providers/registry.js';

const [machine, ...sources] = Bun.argv.slice(2);
if (machine === undefined) throw new Error('usage: adapterProbe.ts <machine directory> <adapter source>...');

type Probed = {
  readonly state: unknown;
  readonly label: string | null;
  readonly inner: unknown;
  readonly refusal: { readonly sameClass: boolean } | null;
  readonly pinned: string | null;
  readonly model?: { readonly text: string; readonly sameClass: boolean };
  readonly contract?: {
    readonly provider: string;
    readonly model: string;
    readonly text: string;
    readonly sameClass: boolean;
    readonly image: string | null;
  };
};

const contractProbe = async (directory: string) => {
  const result = await runConformance(directory, {
    host: { product: { mcpServer: 'contract', client: { name: 'contract', version: 'test' } }, instances: [] },
    provider: 'acme',
    signIn: { kind: 'key', input: 'local-fixture' },
    expectedText: 'hello',
    respond(request, phase) {
      assert.equal(request.headers.authorization, 'Bearer local-fixture');
      if (phase === 'image') {
        assert.equal(request.url, 'https://example.invalid/v1/images/generations');
        return new Response(
          JSON.stringify({
            data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
            output_format: 'png',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (phase === 'failure') return new Response(JSON.stringify({ error: { message: 'local refusal' } }), { status: 401 });
      return new Response(
        'data: {"id":"reply","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\ndata: {"id":"reply","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return {
    provider: result.provider,
    model: result.model,
    text: result.text,
    sameClass: result.failure instanceof LLMError,
    image: result.image?.mediaType ?? null,
  };
};

const modelProbe = Effect.fnUntraced(function* (provider: WireProvider) {
  const method = provider.accounts?.signIns.find((method) => method.kind === 'key');
  if (method?.kind !== 'key') return yield* Effect.die('the template declares no key sign-in');
  const credential = yield* method.store('local-fixture').pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die('the template key sign-in does not use HTTP')),
    ),
  );
  const credentials: ModelCredentials = {
    apiKey: async () => credential.accessToken,
    accessToken: async () => credential.accessToken,
    credential: async () => credential,
  };
  const model = yield* provider.profile.model({ ownerId: 'probe', model: provider.defaultTextModel, credentials });
  const request = new LLMRequest({ model, system: [], messages: [Message.user('contract')], tools: [] });
  let refusing = false;
  const http = HttpClient.make((sent) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(
        sent,
        refusing
          ? new Response(JSON.stringify({ error: { message: 'local refusal' } }), { status: 401 })
          : new Response(
              'data: {"id":"reply","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\ndata: {"id":"reply","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
              { headers: { 'content-type': 'text/event-stream' } },
            ),
      ),
    ),
  );
  const layer = llmClientLayer.pipe(Layer.provide(doorExecutorLayer(http)));
  const invoke = LlmClient.use((client) => client.generate(request));
  const response = yield* invoke.pipe(Effect.provide(layer));
  refusing = true;
  const refused = yield* Effect.flip(invoke).pipe(Effect.provide(layer));
  return { text: response.text, sameClass: refused instanceof LLMError };
});

const program = Effect.gen(function* () {
  const registry = yield* ProviderRegistry;
  const installs = makeMachineAdapters({ machine: machine, registry: registry });
  yield* installs.sweep();
  const probed: Probed[] = [];
  for (const source of sources) {
    const template = source.startsWith('template:');
    const [verb, argument] = /^(remove|update|disable|enable):/.test(source)
      ? source.split(/:(.*)/)
      : ['add', template ? source.slice('template:'.length) : source];
    const id = argument as string;
    const acted: Effect.Effect<unknown, GateRefusal> =
      verb === 'remove'
        ? Effect.as(installs.remove(id), { removed: argument })
        : verb === 'update'
          ? installs.update(id)
          : verb === 'disable'
            ? installs.disable(id)
            : verb === 'enable'
              ? installs.enable(id)
              : installs.install(id);
    const state = yield* Effect.result(acted);
    registry.pinRun('run-1');
    const catalog = registry.current();
    const provider = catalog.wires.registered('acme') ? (catalog.wires.named('acme') as WireProvider & { readonly inner?: unknown }) : null;
    const refused = provider === null ? null : yield* Effect.flip(provider.quota.read(undefined as never, 'probe', 'only'));
    probed.push({
      state: state._tag === 'Success' ? state.success : { refused: state.failure.code },
      label: provider?.label ?? null,
      inner: provider?.inner ?? null,
      refusal: refused === null ? null : { sameClass: refused instanceof LLMError },
      pinned: registry.forRun('run-1').wires.registered('acme') ? registry.forRun('run-1').wires.named('acme').label : null,
      model: template && provider !== null ? yield* modelProbe(provider) : undefined,
      contract:
        template && provider !== null
          ? yield* Effect.promise(() =>
              contractProbe(join(machine, `acme-adapter@${catalog.adapters.find((adapter) => adapter.id === 'acme-adapter')?.version}`)),
            )
          : undefined,
    });
  }
  return probed;
});

const layer = registryLayer.pipe(
  Layer.provide(Layer.succeed(BuiltinAdapters, { sources: [] })),
  Layer.provide(Layer.succeed(AdapterPlaces, { machine, host: HOST_MODULES })),
);

console.log(JSON.stringify(await Effect.runPromise(Effect.provide(program, layer))));
