import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber, Scope, Exit, Stream } from 'effect';
import { voiced } from '../testing/models.ts';
import { controlOf, incoming, scriptedProvider } from '../testing/scriptedProvider.ts';
import { inWorld, settle } from '../testing/world.ts';
import type { SynthesisModel } from '../wire/capabilities.ts';
import type { SynthesisChoice } from './choose.ts';

const texts = (sent: ReadonlyArray<string | Uint8Array>) =>
  sent
    .map(controlOf)
    .filter((frame) => frame?.['type'] === 'text')
    .map((frame) => frame?.['text']);

it.effect('a whole-text model gets the text once at the end, and its audio arrives in whole samples', () =>
  Effect.gen(function* () {
    const speaker = scriptedProvider({ id: 'speaker', synthesis: [voiced('whole', 'whole')] });
    const seen = yield* inWorld([speaker], (world) =>
      Effect.gen(function* () {
        const choice = yield* world.speech.voice({ language: 'en' });
        const synthesis = yield* world.speech.synthesize(choice, {});
        yield* synthesis.say('Hello, ');
        yield* synthesis.say('world');
        yield* synthesis.end;
        const link = yield* world.transport.next;
        yield* link.receive(incoming({ type: 'ready' }));
        yield* link.receive(incoming({ type: 'bytes', bytes: [1, 0, 2] }));
        yield* link.receive(incoming({ type: 'bytes', bytes: [0, 3, 0] }));
        yield* link.receive(incoming({ type: 'done' }));
        const audio = yield* Stream.runCollect(synthesis.audio);
        return { sent: link.sent.map(controlOf), audio };
      }),
    );
    expect(seen.sent).toEqual([{ type: 'init', model: 'whole', voice: 'calm' }, { type: 'text', text: 'Hello, world' }, { type: 'end' }]);
    expect(seen.audio.map((spoken) => (spoken._tag === 'Audio' ? [...spoken.pcm] : []))).toEqual([[1], [2, 3]]);
  }),
);

it.effect('a streaming model gets every piece as it is said, split at its character limit, with marks beside the audio', () =>
  Effect.gen(function* () {
    const speaker = scriptedProvider({ id: 'speaker', synthesis: [voiced('live', 'stream')] });
    const long = `${'word '.repeat(30)}end`;
    const seen = yield* inWorld([speaker], (world) =>
      Effect.gen(function* () {
        const synthesis = yield* world.speech.synthesize(yield* world.speech.voice({}), {});
        const link = yield* world.transport.next;
        yield* synthesis.say('first');
        const beforeReady = texts(link.sent);
        yield* link.receive(incoming({ type: 'ready' }));
        yield* synthesis.say(long);
        yield* link.receive(incoming({ type: 'marks', text: 'first', from: 0, to: 160 }));
        yield* link.receive(incoming({ type: 'bytes', bytes: [1] }));
        yield* link.receive(incoming({ type: 'done' }));
        const audio = yield* Effect.flip(Stream.runCollect(synthesis.audio));
        return { beforeReady, sent: texts(link.sent), audio };
      }),
    );
    expect(seen.beforeReady).toEqual([]);
    expect(seen.sent).toEqual(['first', `${'word '.repeat(20)}`, `${'word '.repeat(10)}end`]);
    expect(seen.audio.reason).toBe('provider');
  }),
);

it.effect('a model that needs a language is not chosen without one, refuses a choice without one, and refuses words after the end', () =>
  Effect.gen(function* () {
    const needing: SynthesisModel = {
      ...voiced('soniox', 'stream'),
      synthesis: { ...voiced('soniox', 'stream').synthesis, needsLanguage: true },
    };
    const speaker = scriptedProvider({ id: 'speaker', synthesis: [needing] });
    const seen = yield* inWorld([speaker], (world) =>
      Effect.gen(function* () {
        const unchosen = yield* Effect.flip(world.speech.voice({}));
        const bare: SynthesisChoice = { provider: 'speaker', model: needing, voice: 'calm', wants: {} };
        const refused = yield* Effect.flip(world.speech.synthesize(bare, {}));
        const synthesis = yield* world.speech.synthesize(yield* world.speech.voice({ language: 'en' }), {});
        const link = yield* world.transport.next;
        yield* link.receive(incoming({ type: 'ready' }));
        yield* synthesis.end;
        const late = yield* Effect.flip(synthesis.say('late'));
        return { unchosen: unchosen.rejected[0]?.reason, refused: refused.reason, late: late.reason };
      }),
    );
    expect(seen).toEqual({
      unchosen: 'it needs the language named in the request',
      refused: 'invalid-request',
      late: 'invalid-request',
    });
  }),
);

it.effect('a model limited to one stream opens the next synthesis only after the first one closes', () =>
  Effect.gen(function* () {
    const single: SynthesisModel = {
      ...voiced('single', 'stream'),
      synthesis: { ...voiced('single', 'stream').synthesis, limits: { streams: 1 } },
    };
    const speaker = scriptedProvider({ id: 'speaker', synthesis: [single] });
    const opened = yield* inWorld([speaker], (world) =>
      Effect.gen(function* () {
        const choice = yield* world.speech.voice({});
        const first = yield* Scope.make();
        yield* Scope.provide(world.speech.synthesize(choice, {}), first);
        const second = yield* Effect.forkChild(Effect.scoped(Effect.andThen(world.speech.synthesize(choice, {}), Effect.never)));
        yield* world.transport.next;
        yield* settle;
        const whileHeld = world.transport.live();
        yield* Scope.close(first, Exit.void);
        yield* world.transport.next;
        const afterClose = world.transport.live();
        yield* Fiber.interrupt(second);
        return [whileHeld, afterClose];
      }),
    );
    expect(opened).toEqual([1, 1]);
  }),
);
