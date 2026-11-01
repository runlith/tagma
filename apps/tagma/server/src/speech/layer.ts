import { AudioDevices } from '@runlith/audio/port/devices';
import { Speech } from '@runlith/speech/engine/Speech';
import { Context, Effect, type FileSystem, Layer } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { Projects } from '../projects/contract/service/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { CallThreads } from './contract/service/callThreads.js';
import { Captures } from './contract/service/captures.js';
import { Recognitions } from './contract/service/recognitions.js';
import { Echo } from './contract/service/echo.js';
import { Handoff } from '../platform/contract/service/handoff.js';
import { Listenings } from './contract/service/listenings.js';
import { LocalModels, Models } from './contract/service/models.js';
import { RecordingsPlace } from './contract/service/recording.js';
import { Speaking } from './contract/service/speaking.js';
import { marked, muted, named } from './listening/annotations.js';
import { LISTENING, makeBooth } from './listening/booth.js';
import { makeCaptures } from './listening/captures.js';
import { described, detailOf } from './listening/detail.js';
import { makeFollowing } from './listening/following.js';
import { textPage } from './listening/page.js';
import { makeRecognitions } from './listening/hearing.js';
import { given, pieceOf, pieceText } from './listening/pieces.js';
import { indexing } from './listening/indexing.js';
import { reading, shelf, transcribed, watching } from './listening/readings.js';
import { makeRecordings } from './listening/recordings.js';
import { makeRehearing } from './listening/rehearing.js';
import { sweeping } from './listening/sweep.js';
import { makeSearch } from './listening/search.js';
import { makeModels } from './models.js';
import { makeSpeaking } from './speaking.js';
import { makeTranscripts } from './store/transcripts.js';

export type SpeechServices = Listenings | Recognitions | Captures | Speaking | Models;
export type SpeechNeeds =
  | Speech
  | AudioDevices
  | Echo
  | LocalModels
  | Handoff
  | MachineStore
  | MachineUnits
  | Settings
  | Projects
  | ProjectChanges
  | CallThreads
  | RecordingsPlace
  | FileSystem.FileSystem;

export const speechLayer: Layer.Layer<SpeechServices, never, SpeechNeeds> = Layer.effectContext(
  Effect.gen(function* () {
    const handoff = yield* Handoff;
    const captures = yield* makeCaptures;
    const transcripts = yield* makeTranscripts;
    const recordings = yield* makeRecordings;
    const booth = yield* makeBooth({ transcripts, captures, recordings });
    yield* Effect.addFinalizer(() =>
      Effect.flatMap(handoff.leaving, (handing) => booth.leave(handing)).pipe(
        Effect.tapError((failure) => Effect.logError('the listenings could not be left in order', { failure })),
        Effect.orDie,
      ),
    );
    const scope = yield* Effect.scope;
    const rehearing = yield* makeRehearing({ booth });
    const swept = transcripts.entries
      .orphans()
      .pipe(Effect.tapError((failure) => Effect.logError('the search entries of removed calls could not be swept', { failure })));
    const removed = (yield* ProjectChanges).removed.subscribe(({ projectId }) =>
      booth.release(projectId).pipe(
        Effect.catchTag(['EffectDrizzleQueryError', 'SqlError'], (failure) =>
          Effect.logWarning('a live listening of a removed project could not be ended; the next boot ends it', {
            project: projectId,
            reason: failure.message,
          }),
        ),
      ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(removed));
    const following = yield* makeFollowing({ booth });
    yield* Effect.forkIn(
      Effect.gen(function* () {
        yield* handoff.opened;
        yield* booth.boot().pipe(
          Effect.tapError((failure) => Effect.logError('the standing listenings could not be read at boot', { failure })),
          Effect.ensuring(booth.booted),
        );
        yield* rehearing
          .boot()
          .pipe(Effect.tapError((failure) => Effect.logError('the calls being recognized again could not be read at boot', { failure })));
        yield* following
          .boot()
          .pipe(Effect.tapError((failure) => Effect.logError('the call followers could not be read at boot', { failure })));
      }),
      scope,
    );
    yield* Effect.forkIn(Effect.andThen(handoff.opened, sweeping(booth)), scope);
    yield* Effect.forkIn(
      Effect.andThen(
        handoff.opened,
        indexing(transcripts.entries).pipe(
          Effect.tapError((failure) => Effect.logError('the transcripts written before search could not be indexed', { failure })),
        ),
      ),
      scope,
    );
    yield* Effect.forkIn(Effect.andThen(handoff.opened, swept), scope);
    const search = yield* makeSearch({ transcripts });
    const recognitions = yield* makeRecognitions({ captures });
    const listenings = Listenings.of({
      start: booth.start,
      end: booth.end,
      list: (ask) => shelf(booth, ask),
      search: search.find,
      read: (ask) => reading(booth, ask),
      mute: (ask) => muted(booth, ask),
      mark: (ask) => marked(booth, ask),
      name: (projectId, id, speaker, name) => named(booth, projectId, id, speaker, name),
      piece: (projectId, id, span) => pieceOf(booth, projectId, id, span),
      pieceText: (projectId, id, cut) => pieceText(booth, projectId, id, cut),
      give: (projectId, id, cut, thread) => given(booth, projectId, id, cut, thread),
      text: (ask) => textPage(booth, ask),
      detail: (projectId, id) => detailOf(booth, projectId, id),
      describe: (ask) => described(booth, ask),
      follow: following.follow,
      again: rehearing.start,
      remove: Effect.fn('Listenings.remove')(function* (projectId, id) {
        yield* booth.owned(projectId, id);
        yield* following.halt(id);
        yield* rehearing.halt(id);
        yield* booth.remove(projectId, id);
      }),
      recording: booth.recording,
      watch: (projectId, id) => watching(booth, projectId, id),
      transcript: (projectId, id, after, stay) => transcribed(booth, projectId, id, after, stay),
      live: captures.count(LISTENING),
    });
    return Context.make(Listenings, listenings).pipe(
      Context.add(Recognitions, recognitions),
      Context.add(Captures, captures),
      Context.add(Speaking, yield* makeSpeaking),
      Context.add(Models, yield* makeModels),
    );
  }),
);
