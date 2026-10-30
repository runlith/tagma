import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Queue, Stream } from 'effect';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { Settings } from '../../../settings/contract/service/values.js';
import { Translations } from '../../../translations/contract/service/translations.js';
import type { TranslationFrame } from '../../../translations/contract/wire/projection.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { ASK_PROGRAM_KEY, ASK_PROGRAM_MODEL, ASK_PROGRAM_PROVIDER } from '../askProgram.js';

const fixture = doorFixture();

const MODEL = 'openai-oauth:gpt-5.5';

const sections = (prompt: string) =>
  [...prompt.matchAll(/^@@ (\d+)\n([\s\S]*?)\n(?=@@ |\s*$)/gmu)].map(([, id, text]) => ({ id: id!, text: text! }));

const shouted = (text: string) =>
  text
    .split(/(⟦\d+⟧)/u)
    .map((piece) => (/^⟦\d+⟧$/u.test(piece) ? piece : piece.toUpperCase()))
    .join('');

type Read = {
  readonly projection: {
    readonly state: string;
    readonly failed: number;
    readonly reason: string | null;
    readonly translated: number;
    readonly changed: number;
    readonly pending: number;
    readonly parts: readonly { readonly kind: string; readonly source: string; readonly state: string; readonly text: string | null }[];
    readonly titles: readonly { readonly name: string; readonly title: string }[];
  } | null;
  readonly languages: readonly { readonly language: string; readonly state: string }[];
};

it.live('a block translates by parts into a stored projection that marks and updates only the parts changed since', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const prompts: string[] = [];
    const held = { part: null as string | null, until: null as Deferred.Deferred<void> | null, asked: yield* Deferred.make<void>() };
    let dropping: string | null = null;
    yield* world.lend({
      models: (standing) => ({
        ...standing,
        request: () => ({
          plannedOutputTokens: 48,
          stream: () => Stream.die(new Error('translation asks once, not by stream')),
          object: () => Effect.die(new Error('translation asks for text')),
          text: Effect.fnUntraced(function* (input) {
            const prompt = input.prompt ?? '';
            prompts.push(prompt);
            if (held.part !== null && held.until !== null && prompt.includes(held.part)) {
              yield* Deferred.succeed(held.asked, undefined);
              yield* Deferred.await(held.until);
            }
            const answer = sections(prompt)
              .map(
                ({ id, text }) =>
                  `@@ ${id}\n«ru» ${shouted(dropping !== null && text.includes(dropping) ? text.replaceAll(/⟦\d+⟧/gu, '') : text)}`,
              )
              .join('\n');
            return new LLMResponse({
              message: Message.assistant(answer),
              events: [{ type: 'text-delta', id: 'answer', text: answer }],
              usage: new Usage({ inputTokens: 40, outputTokens: 20 }),
              finishReason: 'stop',
            });
          }),
        }),
      }),
    });
    const project = yield* world.stealthProject();
    yield* projectLeaving(world, project);
    const at = `project=${project}`;
    const parentId = ((yield* world.op('list_root_blocks', { project })).body as { blocks: { name: string }[] }).blocks[0]!.name;
    const created = (title: string, body: string) =>
      Effect.map(
        world.op('create_block', { project, parentId, title, body }),
        (answer) => (answer.body as { block: { name: string } }).block.name,
      );
    const other = yield* created('Other note', '');
    const intro = `Intro with \`inline code\`, a [link](https://example.com/a(b)c) and [[${other}|the other note]].`;
    const second = `Second paragraph naming [[${other}]] at https://example.com/b.`;
    const code = '```ts\nconst kept = 1;\n```';
    const block = yield* created('Original title', [intro, code, second].join('\n\n'));
    const translate = (input: Record<string, unknown> = {}) => world.op('translate_block', { block, language: 'ru', ...input }, at);
    const read = Effect.suspend(() =>
      Effect.map(world.op('read_block_translation', { block, language: 'ru' }, at), (answer) => answer.body as Read),
    );
    const frames = yield* Queue.unbounded<TranslationFrame>();
    yield* Effect.forkScoped(
      Stream.runForEach(Context.get(world.runtime.owners as Context.Context<Translations>, Translations).changes(project), (frame) =>
        Queue.offer(frames, frame),
      ),
    );
    const until = (name: string, holds: (frame: TranslationFrame) => boolean) =>
      Effect.repeat(Queue.take(frames), { until: (frame) => frame.block === name && holds(frame) });

    expect((yield* translate({ model: 'missing:model' })).body).toMatchObject({
      code: 'ask-unanswerable',
      unblock: [expect.stringContaining('translation.model')],
    });
    expect((yield* translate({ language: 'en-12' })).status).not.toBe(200);
    yield* Context.get(world.runtime.graph, Settings).write({
      key: 'translation.model',
      value: { provider: 'openai-oauth', model: 'gpt-5.5' },
      scope: 'project',
      projectId: project,
    });

    held.part = 'Second paragraph';
    held.until = yield* Deferred.make<void>();
    expect((yield* translate()).body).toMatchObject({ status: 'translating', joined: false, model: MODEL, sending: 3 });
    yield* Deferred.await(held.asked);
    yield* until(block, (frame) => frame.landed === 2);
    expect(yield* read).toMatchObject({
      languages: [{ language: 'ru', state: 'translating' }],
      projection: {
        state: 'translating',
        translated: 2,
        pending: 1,
        parts: [{ state: 'translated' }, { state: 'translated' }, { kind: 'kept', source: code }, { state: 'pending', text: null }],
      },
    });
    expect((yield* translate()).body).toMatchObject({ status: 'translating', joined: true });
    expect((yield* world.op('stop_block_translation', { block, language: 'ru' }, at)).body).toMatchObject({ status: 'stopped' });
    yield* until(block, (frame) => frame.state === 'stopped');
    expect((yield* read).projection).toMatchObject({ state: 'stopped', translated: 2, changed: 1, pending: 0 });

    held.part = null;
    dropping = 'Second paragraph';
    expect((yield* translate()).body).toMatchObject({ status: 'translating', sending: 1 });
    yield* until(block, (frame) => frame.state === 'failed');
    expect(prompts.at(-1)).toContain('Second paragraph');
    expect(prompts.at(-1)).not.toContain('Intro with');
    const failed = (yield* read).projection!;
    expect(failed).toMatchObject({ state: 'failed', failed: 1, reason: expect.stringContaining('placeholder'), translated: 2, changed: 1 });
    const translatedIntro = failed.parts[1]!.text!;
    expect(translatedIntro).toStartWith('«ru» INTRO WITH');
    for (const kept of ['`inline code`', '(https://example.com/a(b)c)', `[[${other}|THE OTHER NOTE]]`])
      expect(translatedIntro).toContain(kept);
    expect(failed.parts[2]).toEqual({ kind: 'kept', source: code, state: 'kept', text: null });

    dropping = null;
    expect((yield* translate()).body).toMatchObject({ status: 'translating', sending: 1 });
    yield* until(block, (frame) => frame.state === 'done');
    const asked = prompts.length;
    expect((yield* translate()).body).toMatchObject({ status: 'current' });
    expect((yield* world.op('translate_block', { block: other, language: 'ru' }, at)).body).toMatchObject({ sending: 1 });
    yield* until(other, (frame) => frame.state === 'done');
    const done = (yield* read).projection!;
    expect(done).toMatchObject({ state: 'done', translated: 3, changed: 0, titles: [{ name: other, title: '«ru» OTHER NOTE' }] });
    expect(done.parts[3]!.text).toBe(`«ru» SECOND PARAGRAPH NAMING [[${other}]] AT https://example.com/b.`);
    expect(prompts.length).toBe(asked + 1);

    const edited = intro.replace('Intro', 'Opening');
    expect((yield* world.op('update_block', { project, blockId: block, body: [edited, code, second].join('\n\n') })).status).toBe(200);
    expect((yield* read).projection).toMatchObject({
      changed: 1,
      parts: [{ state: 'translated' }, { state: 'changed', source: edited, text: null }, { state: 'kept' }, { state: 'translated' }],
    });
    expect((yield* translate()).body).toMatchObject({ status: 'translating', sending: 1 });
    yield* until(block, (frame) => frame.state === 'done');
    expect(prompts.at(-1)).toContain('Opening with');
    expect(prompts.at(-1)).not.toContain('Second paragraph');
    const updated = (yield* read).projection!.parts.map((part) => part.text);
    expect(updated[1]).toStartWith('«ru» OPENING WITH');
    expect([updated[0], updated[2], updated[3]]).toEqual([
      '«ru» ORIGINAL TITLE',
      null,
      `«ru» SECOND PARAGRAPH NAMING [[${other}]] AT https://example.com/b.`,
    ]);

    const long = yield* created('Long note', ['A short opening.', 'Long reading. '.repeat(20)].join('\n\n'));
    const before = prompts.length;
    expect((yield* world.op('translate_block', { block: long, language: 'ru' }, at)).body).toMatchObject({ sending: 3 });
    yield* until(long, (frame) => frame.state === 'failed');
    const cut = (yield* world.op('read_block_translation', { block: long, language: 'ru' }, at)).body as Read;
    expect(cut.projection).toMatchObject({
      failed: 1,
      reason: expect.stringContaining('larger output'),
      parts: [{ state: 'translated' }, { state: 'translated' }, { state: 'changed', text: null }],
    });
    expect(prompts.slice(before).some((prompt) => prompt.includes('Long reading'))).toBe(false);

    const served = Context.get(world.runtime.owners as Context.Context<ProviderRegistry>, ProviderRegistry).current().served.providers;
    const kindsOf = (provider: string, model: string) => served.find((row) => row.id === provider)?.asks[model] ?? [];
    expect(kindsOf('openai-oauth', 'gpt-5.5')).toContain('text');
    expect(kindsOf(ASK_PROGRAM_PROVIDER, ASK_PROGRAM_MODEL)).toContain('text');
    expect(served.find((row) => row.id === 'devin')?.asks).toEqual({});
    const scripted = yield* created('Scripted note', 'Read by a program.');
    const wired = prompts.length;
    expect((yield* world.op('translate_block', { block: scripted, language: 'ru', model: ASK_PROGRAM_KEY }, at)).body).toMatchObject({
      status: 'translating',
      model: ASK_PROGRAM_KEY,
      sending: 2,
    });
    yield* until(scripted, (frame) => frame.state === 'done');
    const programmed = (yield* world.op('read_block_translation', { block: scripted, language: 'ru' }, at)).body as Read;
    expect(programmed.projection?.parts.map((part) => part.text)).toEqual(['«ru» SCRIPTED NOTE', '«ru» READ BY A PROGRAM.']);
    expect(prompts.length).toBe(wired);
  }).pipe(Effect.provide(fixture)),
);
