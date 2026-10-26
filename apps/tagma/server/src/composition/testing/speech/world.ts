import { chunk } from '@runlith/audio/sound/chunk';
import { captureFormat } from '@runlith/audio/sound/format';
import { type Gap, gap } from '@runlith/audio/sound/gap';
import { type FakeDevices, makeFakeDevices } from '@runlith/audio/testing/devices';
import { AudioDevices, type OutputKind } from '@runlith/audio/port/devices';
import type { EndReason } from '@runlith/audio/sound/track';
import type { SpeechProvider } from '@runlith/speech/protocol/adapter';
import type { DuplexTransport } from '@runlith/speech/protocol/transport';
import { Speech } from '@runlith/speech/engine/Speech';
import { fakeDetector } from '@runlith/speech/testing/fakeDetector';
import { streaming, voiced } from '@runlith/speech/testing/models';
import { type Key, scriptedProvider } from '@runlith/speech/testing/scriptedProvider';
import { type ScriptedLink, scriptedTransport } from '@runlith/speech/testing/ScriptedTransport';
import { credentials } from '@runlith/speech/testing/world';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { type Cause, Clock, Context, Effect, Exit, FileSystem, Layer, Queue, Scope, Stream } from 'effect';
import { fixtureMigrations } from '../migrations.js';

import { RecordingsPlace } from '../../../speech/contract/service/recording.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../../platform/store/units.js';
import { projectsLayer } from '../../../projects/registration.js';
import { project } from '../../../projects/store/table.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { ProjectChanges } from '../../../projects/contract/service/changes.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { CallThreads } from '../../../speech/contract/service/callThreads.js';
import { Echo } from '../../../speech/contract/service/echo.js';
import { Handoff } from '../../../speech/contract/service/handoff.js';
import { Listenings } from '../../../speech/contract/service/listenings.js';
import { LocalModels, Models } from '../../../speech/contract/service/models.js';
import { Speaking } from '../../../speech/contract/service/speaking.js';
import type { Line } from '../../../speech/contract/wire/listening.js';
import { speechLayer } from '../../../speech/layer.js';
import { statusOf } from '../../../speech/status.js';
import { makeTranscripts } from '../../../speech/store/transcripts.js';

export const silence = new Int16Array(320);
export const voice = new Int16Array(320).fill(2_000);

export const fallbacks: Settings['Service'] = {
  read: () => Effect.die('read'),
  value: (key) => Effect.succeed(key.fallback),
  chain: () => Effect.die('chain'),
  live: () => Effect.die('live'),
  held: () => Effect.die('held'),
  changes: () => Effect.die('changes'),
  write: () => Effect.die('write'),
  amend: () => Effect.die('amend'),
};

const noModels: LocalModels['Service'] = { list: Effect.succeed([]), install: () => Stream.empty, remove: () => Effect.void };

const scripted = scriptedProvider({ id: 'scripted', recognition: [streaming('live')], synthesis: [voiced('voice', 'stream')] });

export const separating = scriptedProvider({ id: 'scripted', recognition: [streaming('live', { speakers: true })] });

export type World = {
  readonly listenings: Listenings['Service'];
  readonly speaking: Speaking['Service'];
  readonly models: Models['Service'];
  readonly status: ReturnType<typeof statusOf>;
  readonly devices: FakeDevices;
  readonly links: Effect.Effect<ScriptedLink>;
  readonly play: (capture: number, chunks: number) => Effect.Effect<void>;
  readonly sound: (capture: number, at: bigint, pcm: Int16Array) => Effect.Effect<void>;
  readonly overflow: (capture: number, from: bigint, to: bigint) => Effect.Effect<void>;
  readonly drain: (capture: number) => Effect.Effect<void>;
  readonly now: () => bigint;
  readonly skip: (capture: number, ms: number) => Effect.Effect<void>;
  readonly close: (handing: boolean) => Effect.Effect<void>;
};

export type Opening = {
  readonly settings?: Settings['Service'];
  readonly local?: LocalModels['Service'];
  readonly provider?: SpeechProvider<Key, DuplexTransport>;
  readonly recordings?: string;
  readonly threads?: CallThreads['Service'];
  readonly door?: Effect.Effect<void>;
  readonly output?: OutputKind;
  readonly echo?: Echo['Service'];
  readonly ending?: EndReason;
};

const noEcho: Echo['Service'] = { open: () => Effect.die(new Error('no echo canceller opens in this world')) };

const noThreads: CallThreads['Service'] = {
  knows: () => Effect.succeed(false),
  attach: () => Effect.die(new Error('no thread takes a call piece in this world')),
  deliver: () => Effect.die(new Error('no thread takes a call piece in this world')),
  withdraw: () => Effect.succeed(false),
};

export const awaited = Effect.fnUntraced(
  function* <A, E, R>(read: Effect.Effect<A, E, R>, check: (value: A) => boolean, what: string) {
    for (;;) {
      const value = yield* read;
      if (check(value)) return value;
      yield* Effect.sleep(10);
    }
  },
  (effect, _read, _check, what) =>
    effect.pipe(Effect.timeoutOrElse({ duration: '5 seconds', orElse: () => Effect.die(new Error(`waited 5 s for ${what}`)) })),
);

export const until = (check: () => boolean, what: string): Effect.Effect<void> =>
  Effect.asVoid(awaited(Effect.sync(check), (ready) => ready, what));

export const sentFinish = (link: ScriptedLink) => () =>
  link.sent.some((message) => typeof message === 'string' && message.includes('"type":"finish"'));

export const codeOf = (failure: { readonly _tag: string; readonly code?: string }): string => failure.code ?? failure._tag;

export const spoken = (lines: readonly Line[]) =>
  lines.flatMap((line) =>
    line.kind === 'utterance' ? [{ track: line.track, segment: line.segment, seq: line.seq, text: line.text }] : [],
  );

const makeStand = Effect.gen(function* () {
  const context = Context.make(MachineStore, yield* MachineStore).pipe(
    Context.add(MachineUnits, yield* MachineUnits),
    Context.add(FileSystem.FileSystem, yield* FileSystem.FileSystem),
    Context.add(Projects, yield* Projects),
    Context.add(ProjectChanges, yield* ProjectChanges),
  );
  const { root: recordings } = yield* RecordingsPlace;
  const openedWith = Effect.fnUntraced(function* (opening: Opening = {}) {
    const settings = opening.settings ?? fallbacks;
    const transport = yield* scriptedTransport;
    const queues = yield* Effect.forEach([0, 1, 2], () => Queue.unbounded<ReturnType<typeof chunk> | Gap, Cause.Done>());
    const devices = makeFakeDevices({
      output: opening.output,
      capture: (_request, index) => ({ sounds: Stream.fromQueue(queues[index]!), ending: opening.ending }),
    });
    const clock = yield* Clock.Clock;
    const at = [0n, 0n, 0n];
    let handing = false;
    const scope = yield* Scope.fork(yield* Effect.scope);
    const heard = yield* Layer.buildWithScope(
      Speech.layer([opening.provider ?? scripted]).pipe(Layer.provide(Layer.mergeAll(transport.layer, credentials, fakeDetector()))),
      scope,
    );
    const audio = yield* Layer.buildWithScope(devices.layer, scope);
    const deps = Layer.mergeAll(
      Layer.succeedContext(heard),
      Layer.succeedContext(audio),
      Layer.succeed(LocalModels, opening.local ?? noModels),
      Layer.succeed(Settings, settings),
      Layer.succeed(Handoff, { leaving: Effect.sync(() => handing), opened: opening.door ?? Effect.void }),
      Layer.succeed(RecordingsPlace, { root: opening.recordings ?? recordings }),
      Layer.succeed(CallThreads, opening.threads ?? noThreads),
      Layer.succeed(Echo, opening.echo ?? noEcho),
      Layer.succeedContext(context),
    );
    const built = yield* Layer.buildWithScope(speechLayer.pipe(Layer.provide(deps)), scope);
    const next = (capture: number): bigint => {
      const now = at[capture] === 0n ? clock.monotonicTimeNanosUnsafe() : at[capture]!;
      at[capture] = now + 20_000_000n;
      return now;
    };
    const world: World = {
      listenings: Context.get(built, Listenings),
      speaking: Context.get(built, Speaking),
      models: Context.get(built, Models),
      status: statusOf(Context.get(heard, Speech), Context.get(audio, AudioDevices), Context.get(built, Models), settings, 'server'),
      devices,
      links: transport.next,
      play: (capture, chunks) =>
        Effect.forEach(
          Array.from({ length: chunks }),
          (_, index) => Queue.offer(queues[capture]!, chunk(captureFormat, next(capture), index === 0 ? silence : voice)),
          { discard: true },
        ),
      sound: (capture, moment, pcm) => Effect.asVoid(Queue.offer(queues[capture]!, chunk(captureFormat, moment, pcm))),
      overflow: (capture, from, to) => Effect.asVoid(Queue.offer(queues[capture]!, gap(from, to, 'overflow'))),
      drain: (capture) => Effect.asVoid(Queue.end(queues[capture]!)),
      now: () => clock.monotonicTimeNanosUnsafe(),
      skip: (capture, ms) =>
        Effect.asVoid(
          Effect.suspend(() => {
            const from = next(capture);
            at[capture] = from + BigInt(ms) * 1_000_000n;
            return Queue.offer(queues[capture]!, gap(from, at[capture], 'device-change'));
          }),
        ),
      close: (leaving) =>
        Effect.suspend(() => {
          handing = leaving;
          return Scope.close(scope, Exit.void);
        }),
    };
    return world;
  });

  const registered = Effect.fnUntraced(function* (name: string) {
    const { db } = yield* MachineStore;
    const row = yield* (yield* MachineUnits).write(writes('test.project', [project]), (unit) =>
      unit.run(
        db
          .insert(project)
          .values({ name, repoKey: `repo-${name}`, rootPath: `/tmp/${name}`, createdAt: new Date(0) })
          .returning({ id: project.id })
          .get(),
      ),
    );
    return row!.id;
  });
  const transcripts = yield* makeTranscripts;

  return {
    transcripts: Effect.succeed(transcripts),
    recordings,
    opened: openedWith(),
    openedWith,
    registered,
    reader:
      (world: World, projectId: number, id: string) =>
      (after: number, waitMs = 5_000, bytes = 50_000) =>
        world.listenings.read({ projectId, id, after, limit: 50, bytes, waitMs }),
  };
});

export type Stand = Effect.Success<typeof makeStand>;
export class SpeechFixture extends Context.Service<
  SpeechFixture,
  {
    readonly stand: Stand;
    readonly projectId: number;
    readonly elsewhere: number;
    readonly ids: Readonly<Record<string, number>>;
  }
>()('testing/SpeechFixture') {}

const storage = projectsLayer.pipe(
  Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
  Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
  Layer.provideMerge(BunFileSystem.layer),
);
const recordingPlace = Layer.effect(
  RecordingsPlace,
  Effect.gen(function* () {
    return { root: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-speech-' }) };
  }),
).pipe(Layer.provideMerge(storage));

export const speechFixture = (names: { readonly projectId?: string; readonly elsewhere?: string; readonly ids?: readonly string[] } = {}) =>
  Layer.effect(
    SpeechFixture,
    Effect.gen(function* () {
      const stand = yield* makeStand;
      const projectId = names.projectId === undefined ? 0 : yield* stand.registered(names.projectId);
      const elsewhere = names.elsewhere === undefined ? 0 : yield* stand.registered(names.elsewhere);
      const ids = Object.fromEntries(
        yield* Effect.forEach(names.ids ?? [], (name) => Effect.map(stand.registered(`search-${name}`), (id) => [name, id])),
      );
      return { stand, projectId, elsewhere, ids };
    }),
  ).pipe(Layer.provideMerge(recordingPlace));
