# Model and speech providers

A provider part is a module of the folder that `definePlugin` names in `providers`. Tagma imports it into its own server, so it is built apart from `plugin.ts` and may stand alone: a plugin can be nothing but a provider part.

## `plugin.ts`

```ts
import { definePlugin } from '@runlith/tagma/plugin';

export default definePlugin({ id: 'acme', title: 'Acme', providers: './providers.ts' });
```

## `providers.ts`

```ts
import { Effect } from 'effect';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { defineSpeech } from '@runlith/tagma/adapter/speech';
import { defineProviders } from '@runlith/tagma/plugin';
import { acmeProfile, acmeQuota } from './acme.ts';
import { acmeRecognizer, Credential } from './speech.ts';

export default defineProviders({
  models: defineAdapter(() => [
    {
      id: 'acme',
      label: 'Acme',
      kind: 'wire',
      auth: 'api-key',
      keyHint: 'Paste an API key from the Acme console.',
      models: {
        'acme-1': { label: 'Acme 1', capacity: { context: 128_000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null },
      },
      defaultTextModel: 'acme-1',
      cacheLifetime: { promisedSeconds: null, prior: null },
      profile: acmeProfile,
      quota: acmeQuota,
    },
  ]),
  speech: [
    defineSpeech({
      id: 'acme-speech',
      label: 'Acme speech',
      credential: { _tag: 'required', schema: Credential },
      egress: ['api.acme.example'],
      availability: () => Effect.succeed({ _tag: 'present' }),
      recognizer: acmeRecognizer,
    }),
  ],
});
```

- `models` is an adapter: wire providers that answer by request (the request profile and quota come from `@runlith/llm`, as the built-in adapters show), CLI agents — harness providers with a `terminal` or `acp` surface, whose hook codec the CLI's hook process loads from the same module — and an optional settings form (`defineAdapter(provide, settings)`) whose saved instances reach `provide` as `host.instances`.
- `speech` lists speech providers written against the speech kit: requests, events and capabilities from `@runlith/speech/wire/*`, the duplex runner from `@runlith/speech/protocol/duplex`. A provider may require only the HTTP client and the kit's `DuplexTransport`; Tagma gives both. A required credential is a console key the person enters in the console-key window.
- Imports reach Tagma's own copies of `effect`, `@runlith/tagma/adapter/*`, `@runlith/llm/*` and `@runlith/speech/*`; anything else is bundled. A file the module reads at run time sits in `dist/` and is found from `import.meta.dir`.

## Building and installing

`bunx tagma-plugin build` bundles the module into `dist/providers.js`, imports it without calling a provider, and writes `providers: {entry, models, harnesses, speech}` into `tagma-plugin.json`. `install_plugin {source}` installs the folder; its providers join the model menu and Settings → Speech of the whole machine at once, with no restart. Each later build reaches them by itself; a run, an ask, a CLI session or a recognition already going keeps the build it started on.

## `providers.test.ts`

```ts
import { expect, test } from 'bun:test';
import { runConformance } from '@runlith/tagma/testing';
import { acmeReply } from './acme.ts';
import { acmeTranscript } from './speech.ts';

test('the Acme part answers, fails as a model error and recognizes a clip', async () => {
  const result = await runConformance(import.meta.dir, {
    models: {
      host: { product: { mcpServer: 'tagma', client: { name: 'test', version: '0' } }, instances: [] },
      provider: 'acme',
      key: 'test-key',
      expectedText: 'hello',
      respond: (_request, phase) => (phase === 'failure' ? new Response('down', { status: 500 }) : acmeReply('hello')),
    },
    speech: {
      provider: 'acme-speech',
      credential: { key: 'test-key' },
      respond: () => acmeTranscript('hello there'),
    },
  });
  expect(result.models?.text).toBe('hello');
  expect(result.speech?.heard.length).toBeGreaterThan(0);
});
```

`acmeReply` and `acmeTranscript` build the stub answers in the vendor's own wire format. `runConformance(folder, {models?, speech?})` reads the folder's built `tagma-plugin.json` and `dist/providers.js` with no Tagma running. `models` exercises the declared sign-in (`signIn`) or `key`, one model call that must answer `expectedText`, a call `respond` fails, which must reach the caller as Tagma's model error, and an image model when one is declared. `speech` checks the providers against the speech catalog's rules, then runs one recognition or synthesis of `provider` against `respond` (HTTP) or `serve` (a scripted duplex link). Build the folder before `bun test`.
