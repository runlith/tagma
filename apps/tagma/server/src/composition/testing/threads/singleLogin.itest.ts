import { expect } from 'bun:test';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { openModelClient } from '@runlith/llm/models/client';
import { answering, type Sent } from '@runlith/llm/route/transport/answering';
import { Clock, Context, Effect, FileSystem, Layer, Queue, Schema, Stream } from 'effect';
import { modelAccess } from '../../../providers/access.js';
import { HarnessDirectories } from '../../../providers/accounts/harnessRows.js';
import { DefaultAccounts, ProviderAccounts } from '../../../providers/contract/service/accounts.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { ThreadDecisions } from '../../../threads/contract/service/decisions.js';
import { HarnessAsides } from '../../../threads/contract/service/asides.js';
import { Translations } from '../../../translations/contract/service/translations.js';
import type { TranslationFrame } from '../../../translations/contract/wire/projection.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { claudeLogin } from '../claudeLogin.js';
import { settledThread } from '../native-harness/settled.fixture.js';

const SCRIPT = fileURLToPath(new URL('../askProgramScript.ts', import.meta.url));
const CLI = 'single-cli';
const MODEL = 'single-1';
const TRIAGE = {
  state: 'Which migration should be kept?',
  questions: { addressed: { type: 'noul' as const, instructions: 'Is action needed?' } },
};

const Content = Schema.Union([Schema.String, Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) }))]);
const Messages = Schema.Array(Schema.Struct({ role: Schema.optional(Schema.String), content: Schema.optional(Content) }));

const Frame = Schema.Struct({
  model: Schema.String,
  instructions: Schema.optional(Schema.String),
  input: Schema.optional(Messages),
  system: Schema.optional(Content),
  messages: Schema.optional(Messages),
  tools: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.optional(Schema.String) }))),
});

const textOf = (content: typeof Content.Type | undefined): string[] =>
  typeof content === 'string' ? [content] : (content ?? []).flatMap((part) => part.text ?? []);

const events = (stream: readonly { readonly type: string; readonly [field: string]: unknown }[]): Response =>
  new Response(stream.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const reply = (sent: Sent): Response => {
  const request = Schema.decodeUnknownSync(Schema.fromJsonString(Frame))(sent.text);
  const anthropic = request.messages !== undefined;
  const input = (request.input ?? request.messages ?? []).flatMap((message) => textOf(message.content)).join('\n');
  const object = request.tools?.some((tool) => tool.name === 'generate_object') === true;
  const sections = [...input.matchAll(/^@@ (\d+)\n([\s\S]*?)\n(?=@@ |\s*$)/gmu)];
  const text = /name conversations/u.test(`${[request.instructions ?? '', ...textOf(request.system)].join('\n')}\n${input}`)
    ? 'TITLE: Wire title'
    : sections.length > 0
      ? sections.map(([, id, part]) => `@@ ${id}\n«ru» ${part!.toUpperCase()}`).join('\n')
      : 'Ready.';
  if (anthropic)
    return events([
      { type: 'message_start', message: { id: 'msg_single', usage: { input_tokens: 100 } } },
      object
        ? { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'answer', name: 'generate_object' } }
        : { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      object
        ? { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ addressed: true }) } }
        : { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: object ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ]);
  const answer = object
    ? {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          id: 'answer',
          call_id: 'answer',
          name: 'generate_object',
          arguments: JSON.stringify({ addressed: true }),
        },
      }
    : { type: 'response.output_text.delta', delta: text };
  return new Response(
    [answer, { type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 20 } } }]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};

const jwt = (claims: object): string => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;

const packageText = `
import { defineAdapter } from '@runlith/tagma/adapter/provider';
const models = { '${MODEL}': { label: 'Single', capacity: { context: 32000, input: 512, output: 4096 }, capabilities: ['text'], reasoning: [], defaultReasoning: null } };
const accounts = { directory: 'single', login: { program: 'single', args: ['login'] }, status: { program: 'single', args: ['status'] }, loggedIn: () => { throw new Error('a signed directory needs no status process'); } };
export const adapter = defineAdapter(() => ['${CLI}', 'silent-cli'].map((id) => ({
  id, label: id, kind: 'harness', auth: 'cli', models, accounts,
  defaultTextModel: '${MODEL}', lightTextModel: { model: '${MODEL}', rung: null }, cacheLifetime: { promisedSeconds: null, prior: null }, environment: () => [],
  asks: id === 'silent-cli' ? undefined : { program: {
    command: process.execPath, schemas: false, argv: (ask) => [import.meta.dir + '/ask.ts', '--model', ask.model, '--system', ask.system],
    answer: ({ stdout, stderr, exit }) => exit === 0 ? { _tag: 'Text', text: JSON.parse(stdout).text } : { _tag: 'Refused', refusal: 'ask-provider-failed', message: stderr },
  } },
})));
`;

const makeFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.makeTempDirectoryScoped({ prefix: 'single-asks-' });
  const bin = join(root, 'bin');
  yield* files.makeDirectory(bin);
  yield* files.writeFileString(
    join(bin, 'claude'),
    `#!/bin/sh\nif [ "$1" = --version ]; then echo 'fixture 1.0'; exit; fi\nASK_PROGRAM_FORMAT=claude exec '${process.execPath}' '${SCRIPT}' "$@"\n`,
    { mode: 0o755 },
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = { path: process.env.PATH, argv: [...process.execArgv] };
      process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
      if (!process.execArgv.includes('--no-install')) process.execArgv.push('--no-install');
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        process.env.PATH = previous.path;
        process.execArgv.splice(0, process.execArgv.length, ...previous.argv);
      }),
  );
  const world = yield* makeDoorWorld({ own: 'switches the machine between its only signed-in account and installs one ask adapter' });
  const registry = Context.get(world.runtime.owners, ProviderRegistry);
  const defaults = Context.get(world.runtime.owners, DefaultAccounts);
  const directories = Context.get(world.runtime.owners, HarnessDirectories);
  const accounts = Context.get(world.runtime.owners, ProviderAccounts);
  const asides = Context.get(world.runtime.owners, HarnessAsides);
  const decisions = Context.get(world.runtime.owners, ThreadDecisions);
  const signed = { entries: [] as string[] };
  const client = yield* openModelClient(
    answering((sent) => {
      signed.entries.push(sent.headers.authorization ?? '');
      try {
        return reply(sent);
      } catch (cause) {
        return new Response(JSON.stringify({ error: { message: String(cause) } }), { status: 400 });
      }
    }),
  );
  const access = modelAccess(registry, () => world.runtime.tokens, defaults.defaultAccount, client, world.runtime.consoleKeys);
  yield* world.lend({ models: () => access, quotaProviders: [] });
  return { world, root, registry, directories, accounts, asides, decisions, signed };
});

class SingleLoginFixture extends Context.Service<SingleLoginFixture, Effect.Success<typeof makeFixture>>()('testing/SingleLoginFixture') {}

layer(Layer.effect(SingleLoginFixture, makeFixture).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'single-login asks',
  (it) => {
    it.effect(
      'each single login serves translation, titles and decisions through its package path; no connected path refuses once per feature',
      () =>
        Effect.gen(function* () {
          const { world, root, registry, directories, accounts, asides, decisions, signed } = yield* SingleLoginFixture;
          const files = yield* FileSystem.FileSystem;
          const projectId = yield* world.knowledgeProject();
          yield* projectLeaving(world, projectId);
          const at = `project=${projectId}`;
          const op = (id: string, input: unknown) => world.op(id, input, at);
          const roots = yield* op('list_root_blocks', { project: projectId });
          const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
          const block = (
            (yield* op('create_block', { project: projectId, parentId, title: 'Fixture', body: '' })).body as { block: { name: string } }
          ).block.name;
          for (const key of ['threads.autoTitle', 'threads.recap'])
            expect(yield* op('write_setting', { key, value: false })).toMatchObject({ status: 200 });
          const frames = yield* Queue.unbounded<TranslationFrame>();
          yield* Effect.forkScoped(
            Stream.runForEach(Context.get(world.runtime.owners, Translations).changes(projectId), (frame) => Queue.offer(frames, frame)),
          );
          const directory = yield* files.makeTempDirectoryScoped({ directory: root, prefix: 'login-' });
          const keep = (provider: string) =>
            Effect.acquireRelease(
              directories.keep(provider, {
                key: AccountKey.make('only'),
                label: 'Only login',
                machine: directories.machine,
                directory,
                requested: true,
                signed: true,
                pending: false,
                addedAt: 1,
              }),
              () => directories.remove(provider, AccountKey.make('only')).pipe(Effect.orDie),
            );
          const source = join(root, 'adapter');
          yield* files.makeDirectory(source);
          yield* files.writeFileString(
            join(source, 'package.json'),
            JSON.stringify({ name: 'single-ask-adapter', version: '1.0.0', type: 'module', exports: { '.': './adapter.ts' } }),
          );
          yield* files.writeFileString(join(source, 'adapter.ts'), packageText);
          yield* files.copyFile(SCRIPT, join(source, 'ask.ts'));
          expect(yield* op('install_adapter', { source })).toMatchObject({ status: 200 });
          let threadId: string | undefined;
          const cases = [
            {
              provider: 'openai',
              path: 'request',
              bearer: 'Bearer only-key',
              connect: Effect.acquireRelease(world.runtime.consoleKeys.save('openai', 'only-key'), (account) =>
                world.runtime.signIns.removeConsoleKey('openai', account).pipe(Effect.orDie),
              ),
            },
            {
              provider: 'openai-oauth',
              path: 'request',
              bearer: 'Bearer only-chatgpt',
              connect: Effect.gen(function* () {
                yield* registry.selectMode('codex', 'tagma');
                return yield* Effect.acquireRelease(
                  world.runtime.tokens.add('openai-oauth', {
                    accessToken: 'only-chatgpt',
                    refreshToken: 'refresh',
                    expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
                    accountId: 'only',
                  }),
                  (account) => world.runtime.signIns.remove('openai-oauth', account).pipe(Effect.orDie),
                );
              }),
            },
            {
              provider: 'codex',
              path: 'request',
              bearer: '',
              connect: Effect.gen(function* () {
                yield* registry.selectMode('codex', 'codex');
                const token = jwt({ exp: Math.floor((yield* Clock.currentTimeMillis) / 1000) + 3600 });
                yield* files.writeFileString(
                  join(directory, 'auth.json'),
                  JSON.stringify({
                    auth_mode: 'chatgpt',
                    tokens: {
                      access_token: token,
                      refresh_token: 'refresh',
                      id_token: jwt({ email: 'only@example.com', chatgpt_account_id: 'only' }),
                      account_id: 'only',
                    },
                  }),
                );
                yield* keep('codex');
                return `Bearer ${token}`;
              }),
            },
            {
              provider: 'claude-code',
              path: 'request',
              bearer: 'Bearer lent-token',
              connect: claudeLogin(world, { restore: false }).pipe(
                Effect.tap((account) => Effect.addFinalizer(() => directories.remove('claude-code', account).pipe(Effect.orDie))),
                Effect.tap((account) =>
                  Effect.gen(function* () {
                    const lent = (yield* directories.of('claude-code')).find((row) => row.key === account)!.directory!;
                    yield* files.writeFileString(
                      join(lent, 'credential.json'),
                      JSON.stringify({
                        accessToken: 'lent-token',
                        refreshToken: 'refresh',
                        expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
                        scope: 'user:inference',
                        account: { uuid: 'fixture-account', email: 'fixture@example.com' },
                        organization: { uuid: 'fixture-org', name: 'Fixture' },
                      }),
                    );
                  }),
                ),
              ),
            },
            { provider: CLI, path: 'program', bearer: null, connect: keep(CLI) },
          ] as const;
          for (const lane of cases)
            yield* Effect.scoped(
              Effect.gen(function* () {
                const connected = yield* lane.connect;
                const model = registry.current().models.defaultTextModelId(lane.provider);
                expect(yield* op('set_model_defaults', { provider: lane.provider, model, reasoning: null, account: null })).toMatchObject({
                  status: 200,
                });
                const linked = [...(yield* accounts.connected).providers];
                expect(linked).toEqual(expect.arrayContaining([lane.provider]));
                expect(
                  linked.every(
                    (provider) =>
                      provider === lane.provider ||
                      (lane.provider === 'codex' && provider === 'openai-oauth') ||
                      (lane.provider === 'claude-code' && provider === 'subscription'),
                  ),
                ).toBe(true);
                signed.entries = [];
                if (threadId === undefined) {
                  const created = yield* op('create_thread', { type: 'tagma' });
                  const born = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(created.body);
                  threadId = born.snapshot.thread.id;
                  expect(yield* op('start_turn', { threadId, text: 'Fix the uploader retry.', key: crypto.randomUUID() })).toMatchObject({
                    status: 200,
                  });
                  yield* settledThread({ threadId, projectId }).pipe(Effect.provide(world.runtime.owners));
                }
                yield* asides.forget(threadId);
                expect(yield* op('translate_block', { block, language: 'ru', again: true })).toMatchObject({
                  status: 200,
                  body: { status: 'translating' },
                });
                const translated = yield* Effect.repeat(Queue.take(frames), {
                  until: (frame) => frame.block === block && (frame.state === 'done' || frame.state === 'failed'),
                });
                const reading = yield* op('read_block_translation', { block, language: 'ru' });
                if (translated.state !== 'done') return yield* Effect.die(JSON.stringify(reading.body));
                expect(reading).toMatchObject({ status: 200, body: { projection: { parts: [{ text: '«ru» FIXTURE' }] } } });
                expect(yield* op('generate_thread_title', { threadId })).toMatchObject({
                  status: 200,
                  body: { outcome: 'named', source: 'fresh', title: lane.path === 'request' ? 'Wire title' : 'Program title' },
                });
                expect(yield* decisions.decide(threadId, TRIAGE)).toMatchObject({
                  path: lane.path,
                  answers: { addressed: { type: 'noul', noul: true } },
                });
                if (lane.provider === CLI) {
                  const body = [1, 2, 3].map((part) => `${'Read this paragraph. '.repeat(35)}${part}`).join('\n\n');
                  const narrow = (
                    (yield* op('create_block', { project: projectId, parentId, title: 'Narrow', body })).body as { block: { name: string } }
                  ).block.name;
                  expect(yield* op('translate_block', { block: narrow, language: 'ru' })).toMatchObject({ status: 200 });
                  const ended = yield* Effect.repeat(Queue.take(frames), {
                    until: (frame) => frame.block === narrow && (frame.state === 'done' || frame.state === 'failed'),
                  });
                  expect(ended).toMatchObject({ state: 'done', landed: 4 });
                }
                if (lane.path === 'request')
                  expect(signed.entries).toEqual(expect.arrayContaining([lane.provider === 'codex' ? connected : lane.bearer]));
                else expect(signed.entries).toEqual([]);
              }),
            );
          yield* keep('silent-cli');
          expect((yield* accounts.connected).providers).toEqual(new Set(['silent-cli']));
          expect(yield* op('translate_block', { block, language: 'ru', again: true })).toMatchObject({
            body: { code: 'ask-unanswerable' },
          });
          expect(yield* op('generate_thread_title', { threadId })).toMatchObject({ body: { code: 'ask-unanswerable' } });
          expect(yield* Effect.flip(decisions.decide(threadId!, TRIAGE))).toMatchObject({ refusal: 'ask-unanswerable' });
        }),
    );
  },
);
