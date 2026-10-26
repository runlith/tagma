import type { Format } from '@runlith/audio/sound/format';
import { type Cause, type Context, Effect, Queue, Result, type Scope, type Semaphore, Stream } from 'effect';
import type { Spoken, Synthesis } from '../protocol/adapter.ts';
import { forkWatched } from '../protocol/watch.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { SynthesisRequest } from '../wire/requests.ts';
import { credentialOf, rateFor, within } from './access.ts';
import type { SpeechCatalog } from './catalog.ts';
import type { SynthesisChoice } from './choose.ts';
import { fitsSynthesis } from './fits.ts';
import type { SynthesisOptions } from './Speech.ts';
import type { SpeechCredentials } from './SpeechCredentials.ts';
import type { SpeechDetector } from './SpeechDetector.ts';

export const pieces = (text: string, characters: number | undefined): ReadonlyArray<string> => {
  if (characters === undefined || text.length <= characters) return text === '' ? [] : [text];
  const parts: Array<string> = [];
  let rest = text;
  while (rest.length > characters) {
    const space = rest.lastIndexOf(' ', characters);
    const cut = space > 0 ? space + 1 : characters;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest !== '') parts.push(rest);
  return parts;
};

const streamed = (inner: Synthesis, characters: number | undefined): Synthesis => ({
  ...inner,
  say: (text) => Effect.forEach(pieces(text, characters), inner.say, { discard: true }),
});

const whole = Effect.fnUntraced(function* (
  format: Format,
  open: Effect.Effect<Synthesis, SpeechFailure, Scope.Scope>,
  characters: number | undefined,
): Effect.fn.Return<Synthesis, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const audio = yield* Queue.unbounded<Spoken, SpeechFailure | Cause.Done>();
  yield* Effect.addFinalizer(() => Queue.shutdown(audio));
  const texts: Array<string> = [];
  let ended = false;
  const refused = () => Effect.fail(SpeechFailure.invalidRequest('the synthesis has ended'));
  const speak = Effect.fnUntraced(function* (part: string) {
    const inner = yield* open;
    if (inner.format.rate !== format.rate || inner.format.channels !== format.channels)
      return yield* Effect.fail(SpeechFailure.provider('the synthesizer opened in another format', false));
    yield* inner.say(part);
    yield* inner.end;
    yield* Stream.runForEach(inner.audio, (spoken) => Queue.offer(audio, spoken));
  });
  const run = Effect.fnUntraced(function* (parts: ReadonlyArray<string>) {
    const spoken = yield* Effect.result(Effect.forEach(parts, speak, { discard: true }));
    yield* Result.isFailure(spoken) ? Queue.fail(audio, spoken.failure) : Queue.end(audio);
  });
  const synthesis: Synthesis = {
    format,
    say: (text) =>
      Effect.suspend(() => {
        if (ended) return refused();
        texts.push(text);
        return Effect.void;
      }),
    end: Effect.suspend(() => {
      if (ended) return refused();
      ended = true;
      return Effect.asVoid(forkWatched(Effect.scoped(run(pieces(texts.join(''), characters))), scope, audio));
    }),
    audio: Stream.fromQueue(audio),
  };
  return synthesis;
});

export const synthesis = Effect.fnUntraced(function* <R>(
  catalog: SpeechCatalog<R>,
  context: Context.Context<R | SpeechCredentials | SpeechDetector>,
  streams: (provider: string, model: string) => Semaphore.Semaphore | undefined,
  choice: SynthesisChoice,
  options: SynthesisOptions,
): Effect.fn.Return<Synthesis, SpeechFailure, Scope.Scope> {
  const provider = catalog.provider(choice.provider);
  const synthesizer = provider?.synthesizer;
  const model = synthesizer?.models.find((candidate) => candidate.id === choice.model.id);
  if (provider === undefined || synthesizer === undefined || model === undefined)
    return yield* Effect.fail(SpeechFailure.invalidRequest(`${choice.provider}/${choice.model.id} is not a registered synthesizer`));
  const capabilities = model.synthesis;
  const wants = choice.wants;
  const fits = fitsSynthesis(capabilities, choice.voice, wants);
  if (Result.isFailure(fits)) return yield* Effect.fail(fits.failure);
  const request: SynthesisRequest = {
    voice: choice.voice,
    rate: rateFor(capabilities.rates, options.rate ?? capabilities.rates[0] ?? 24_000),
    language: wants.language,
    timestamps: wants.timestamps === true,
    instructions: wants.instructions,
  };
  const permits = streams(provider.id, model.id);
  if (permits !== undefined) yield* Effect.acquireRelease(permits.take(1), () => permits.release(1));
  const open = Effect.flatMap(Effect.provideContext(credentialOf(provider, options.account), context), (credential) =>
    within(synthesizer.open(model, request, credential), context),
  );
  const characters = capabilities.limits.characters;
  if (capabilities.text === 'whole') return yield* whole({ rate: request.rate, channels: 1 }, open, characters);
  return streamed(yield* open, characters);
});
