import { expect } from 'bun:test';
import { resolve } from 'node:path';
import { it } from '@runlith/effect-test';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { Effect, Stream } from 'effect';
import { writePlugin } from '../../plugin-formats/tagma/testing/folder.js';
import { fixtureEntries } from '../../plugin-host/testing/tools.js';
import { DoorFixture, doorFixture, projectLeaving } from './doorFixture.js';

const FIXTURE = resolve(import.meta.dir, '../../plugin-host/testing/fixture.ts');
const caller = (id: string): Readonly<Record<string, string>> => ({ 'x-tagma-caller': `plugin:${id}` });
const POKER = caller('poker');
const OTHER = caller('other');
const MODEL = { provider: 'openai-oauth', model: 'gpt-5.5' } as const;
const SCORE = { type: 'object', properties: { score: { type: 'number' } }, required: ['score'] } as const;

const fixture = doorFixture();

const installed = Effect.fnUntraced(function* (world: DoorFixture['Service'], projectId: number, id: string) {
  const folder = yield* world.directory(`${id}-plugin`);
  yield* Effect.promise(() => writePlugin(folder, { id, program: FIXTURE, contributes: { tools: fixtureEntries({}) } }));
  const answer = yield* world.op('install_plugin', { source: folder }, `project=${projectId}`);
  expect(answer.body).toMatchObject({ plugin: { id, enabled: true } });
  yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id }, `project=${projectId}`).pipe(Effect.orDie));
});

it.live('a plugin reads the model menu and asks a model once, and its card reads what the asks spent', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const asked: { readonly model: string | undefined; readonly system: string; readonly prompt: string }[] = [];
    const answered = new LLMResponse({
      message: Message.assistant('Hallo'),
      events: [{ type: 'text-delta', id: 'answer', text: 'Hallo' }],
      usage: new Usage({ inputTokens: 40, outputTokens: 20 }),
      finishReason: 'stop',
    });
    yield* world.lend({
      models: (standing) => ({
        ...standing,
        request: (input) => ({
          plannedOutputTokens: 48,
          stream: () => Stream.die(new Error('an ask is answered once, not streamed')),
          text: (call) =>
            Effect.sync(() => {
              asked.push({ model: input.model ?? undefined, system: input.instructions ?? '', prompt: call.prompt ?? '' });
              return answered;
            }),
          object: (call) =>
            Effect.sync(() => {
              asked.push({ model: input.model ?? undefined, system: input.instructions ?? '', prompt: call.prompt ?? '' });
              return { object: { score: 4 } as never, response: answered };
            }),
        }),
      }),
    });
    const projectId = yield* world.plainProject();
    yield* projectLeaving(world, projectId);
    yield* installed(world, projectId, 'poker');
    yield* installed(world, projectId, 'other');
    const at = `project=${projectId}`;
    yield* Effect.addFinalizer(() => world.op('write_setting_layer', { scope: 'user', key: 'ask.model' }, at).pipe(Effect.orDie));
    const ask = (input: Readonly<Record<string, unknown>>, headers = POKER) => world.op('ask_model', input, '', headers);

    const menu = yield* world.op('read_model_menu', {}, '', POKER);
    expect(menu.status).toBe(200);
    expect(menu.body).toMatchObject({
      status: 'read',
      providers: expect.arrayContaining([
        expect.objectContaining({ id: MODEL.provider, models: expect.arrayContaining([expect.objectContaining({ id: MODEL.model })]) }),
      ]),
    });

    expect((yield* ask({ prompt: 'Say hello.', system: 'Be brief.', model: MODEL })).body).toEqual({ status: 'text', text: 'Hallo' });
    expect(asked).toEqual([{ model: MODEL.model, system: 'Be brief.', prompt: 'Say hello.' }]);

    expect((yield* ask({ prompt: 'Grade it.', model: MODEL, schema: SCORE })).body).toEqual({ status: 'object', value: { score: 4 } });

    const unanswerable = yield* ask({ prompt: 'Say hello.', model: { provider: 'missing', model: 'nobody' } });
    expect(unanswerable.body).toMatchObject({ code: 'ask-unanswerable' });
    expect(asked).toHaveLength(2);

    expect(yield* world.op('write_setting_layer', { scope: 'user', key: 'ask.model', value: MODEL }, at)).toMatchObject({ status: 200 });
    expect((yield* ask({ prompt: 'Say hello again.' })).body).toEqual({ status: 'text', text: 'Hallo' });
    expect(asked.at(-1)).toMatchObject({ model: MODEL.model, prompt: 'Say hello again.' });

    const poker = yield* world.op('read_ask_usage', { caller: 'plugin:poker' });
    expect(poker.body).toMatchObject({ status: 'read', hours: 24, asks: 3, unanswered: 0, inputTokens: 120, outputTokens: 60 });
    const other = yield* world.op('read_ask_usage', { caller: 'plugin:other' });
    expect(other.body).toMatchObject({ status: 'read', asks: 0, unanswered: 0, inputTokens: 0, outputTokens: 0 });
    expect((yield* ask({ prompt: 'Hi.' }, OTHER)).body).toEqual({ status: 'text', text: 'Hallo' });
    expect((yield* world.op('read_ask_usage', { caller: 'plugin:other' })).body).toMatchObject({ asks: 1, inputTokens: 40 });
  }).pipe(Effect.provide(fixture)),
);
