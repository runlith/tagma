import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { chunk } from '@runlith/audio/sound/chunk';
import { ended } from '@runlith/audio/sound/track';
import { layer } from '@runlith/effect-test';
import { Speech } from '@runlith/speech/engine/Speech';
import { LIVE } from '@runlith/speech/wire/capabilities';
import { Context, Effect, Exit, FileSystem, Layer, Schedule, Scope, Stream } from 'effect';
import { MANIFEST } from '../../../plugin-formats/tagma/contract/wire/manifest.js';
import { manifestText, PROVIDERS_ENTRY } from '../../../plugin-formats/tagma/testing/folder.js';
import { makeDoorWorld } from '../doorFixture.js';

type Answer = { readonly status: number; readonly body: unknown };
type Row = { readonly id: string; readonly faults: readonly { readonly point: string; readonly detail: string }[] };
type Listed = { readonly provider: string; readonly model: string; readonly label: string };

const noInstall = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(() => {
      const kept = [...process.execArgv];
      if (!process.execArgv.includes('--no-install')) process.execArgv.push('--no-install');
      return kept;
    }),
    (kept) => Effect.sync(() => void process.execArgv.splice(0, process.execArgv.length, ...kept)),
  ),
);

const echo = (id: string, label: string, words: string, turns = "['provider']") => `
import { Deferred, Effect, Stream } from 'effect';
import { SpeechEvent } from '@runlith/speech/wire/events';
const model = {
  id: '${id}-1',
  label: '${label}',
  recognition: {
    kind: 'stream', rates: [16000], partials: false, turns: ${turns}, finalize: false, timestamps: 'segment',
    speakers: false, confidence: false, languages: { codes: ['en'], hints: 1, detect: true },
    prompting: { prompt: false, terms: false }, limits: {}, tuning: [],
  },
};
export default {
  speech: [{
    id: '${id}', label: '${id}', credential: { _tag: 'none', value: undefined }, egress: [],
    availability: () => Effect.succeed({ _tag: 'present' }),
    recognizer: {
      models: [model],
      stream: (_model, request) => Effect.map(Deferred.make(), (done) => ({
        format: { rate: request.rate, channels: 1 },
        send: () => Effect.void,
        commit: () => Effect.void,
        finalize: Effect.void,
        finish: Effect.asVoid(Deferred.succeed(done, undefined)),
        delivered: Effect.succeed(0),
        events: Stream.unwrap(Effect.as(Deferred.await(done), Stream.make(
          SpeechEvent.final('t', [{ lane: 'source', text: '${words}', granularity: 'segment' }]),
          SpeechEvent.turnEnd('t'),
          SpeechEvent.finished,
        ))),
      })),
    },
  }],
};
`;

const part = Effect.fnUntraced(function* (directory: string, id: string, code: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(join(directory, 'dist'), { recursive: true });
  yield* files.writeFileString(
    join(directory, MANIFEST),
    manifestText({ id, providers: { models: false, harnesses: false, speech: true } }),
  );
  yield* files.writeFileString(join(directory, PROVIDERS_ENTRY), code);
  return directory;
});

class World extends Context.Service<
  World,
  {
    readonly op: (id: string, input: unknown) => Effect.Effect<Answer>;
    readonly root: string;
    readonly speech: Speech['Service'];
  }
>()('testing/SpeechPluginsWorld') {}

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const door = yield* makeDoorWorld({ own: 'installs speech provider plugins' });
    const files = yield* FileSystem.FileSystem;
    const project = `project=${yield* door.stealthProject()}`;
    return {
      op: (id: string, input: unknown) => door.op(id, input, project),
      root: yield* files.makeTempDirectoryScoped({ prefix: 'speech-plugins-' }),
      speech: Context.get(door.runtime.owners, Speech),
    };
  }),
);

const status = Effect.fnUntraced(function* () {
  const { op } = yield* World;
  return ((yield* op('speech_status', {})).body as { readonly speech: { readonly models: readonly Listed[] } }).speech.models;
});

const rows = Effect.fnUntraced(function* () {
  const { op } = yield* World;
  const found: Row[] = [];
  let cursor: string | null | undefined;
  do {
    const read = yield* op('read_plugins', cursor === undefined ? { limit: 8 } : { limit: 8, cursor });
    const body = read.body as { readonly plugins: readonly Row[]; readonly next: string | null };
    found.push(...body.plugins);
    cursor = body.next;
  } while (cursor !== null);
  return found;
});

const until = <A, R>(read: Effect.Effect<A, never, R>, done: (value: A) => boolean) =>
  Effect.repeat(read, { until: done, schedule: Schedule.spaced('20 millis'), times: 500 });

const format = { rate: 16_000, channels: 1 };

const heard = Effect.fnUntraced(function* (speech: Speech['Service']) {
  const set = yield* speech.take;
  const choice = yield* set.recognizer({ kinds: LIVE, provider: 'echo' });
  const track = { format, chunks: Stream.make(chunk(format, 0n, new Int16Array(3_200)), ended('drained')), end: Effect.void };
  const all = yield* Stream.runCollect(set.recognize(choice, track, { track: 'mic', origin: 0n }));
  return all.flatMap((one) => (one._tag === 'Utterance' && one.closed ? [one.text] : []));
});

layer(world.pipe(Layer.provideMerge(noInstall), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'speech from plugins',
  (it) => {
    it.effect('a plugin’s speech provider is in speech_status at once and recognizes; a rebuild serves the next work', () =>
      Effect.gen(function* () {
        const { op, root, speech } = yield* World;
        const folder = yield* part(join(root, 'echo'), 'echo-speech', echo('echo', 'Echo A', 'plugin words'));
        expect(yield* op('install_plugin', { source: folder })).toMatchObject({ status: 200 });
        const listed = yield* until(status(), (models) => models.some((model) => model.provider === 'echo'));
        expect(listed.find((model) => model.provider === 'echo')).toMatchObject({ model: 'echo-1', label: 'Echo A' });
        expect(yield* Effect.scoped(heard(speech))).toEqual(['plugin words']);

        const work = yield* Scope.make();
        yield* Scope.provide(speech.take, work);
        const first = [...speech.revisions()];
        yield* part(folder, 'echo-speech', echo('echo', 'Echo B', 'rebuilt words'));
        yield* until(status(), (models) => models.some((model) => model.label === 'Echo B'));
        expect(yield* Effect.scoped(heard(speech))).toEqual(['rebuilt words']);
        const files = yield* FileSystem.FileSystem;
        const held = first.filter((directory) => directory.includes('echo-speech'));
        expect(held.length).toBe(1);
        expect(yield* files.exists(held[0]!)).toBe(true);
        yield* Scope.close(work, Exit.void);
        expect(yield* until(files.exists(held[0]!).pipe(Effect.orDie), (standing) => !standing)).toBe(false);

        expect(yield* op('uninstall_plugin', { id: 'echo-speech' })).toMatchObject({ status: 200 });
        expect(yield* until(status(), (models) => !models.some((model) => model.provider === 'echo'))).not.toContainEqual(
          expect.objectContaining({ provider: 'echo' }),
        );
      }),
    );

    it.effect('turning OpenAI off everywhere takes its speech out of speech_status until it is on again', () =>
      Effect.gen(function* () {
        const { op } = yield* World;
        expect((yield* status()).some((model) => model.provider === 'openai')).toBe(true);
        expect(yield* op('enable_plugin', { id: 'openai', enabled: false, scope: 'machine' })).toMatchObject({ status: 200 });
        yield* until(status(), (models) => !models.some((model) => model.provider === 'openai'));
        expect(yield* op('enable_plugin', { id: 'openai', enabled: true, scope: 'machine' })).toMatchObject({ status: 200 });
        expect((yield* until(status(), (models) => models.some((model) => model.provider === 'openai'))).length).toBeGreaterThan(0);
      }),
    );

    it.effect('a speech part that throws, or whose provider breaks the catalog rules, reads broken and leaves the rest standing', () =>
      Effect.gen(function* () {
        const { op, root } = yield* World;
        const broken = yield* part(join(root, 'thrown'), 'thrown-speech', "throw new Error('the speech part is broken');\n");
        const bent = yield* part(join(root, 'bent'), 'bent-speech', echo('bent', 'Bent', 'never', '[]'));
        for (const source of [broken, bent]) expect(yield* op('install_plugin', { source })).toMatchObject({ status: 200 });
        const faulted = yield* until(rows(), (listed) =>
          ['thrown-speech', 'bent-speech'].every((id) =>
            listed.find((row) => row.id === id)?.faults.some((fault) => fault.point === 'speech'),
          ),
        );
        expect(faulted.find((row) => row.id === 'thrown-speech')?.faults).toEqual([
          expect.objectContaining({ point: 'speech', detail: expect.stringContaining('the speech part is broken') }),
        ]);
        expect(faulted.find((row) => row.id === 'bent-speech')?.faults).toEqual([
          expect.objectContaining({ point: 'speech', detail: expect.stringContaining('supports no turn mode') }),
        ]);
        expect((yield* status()).some((model) => model.provider === 'openai')).toBe(true);
        for (const id of ['thrown-speech', 'bent-speech']) expect(yield* op('uninstall_plugin', { id })).toMatchObject({ status: 200 });
      }),
    );
  },
);
