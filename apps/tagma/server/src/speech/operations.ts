import { mintCursor, pageRows, type PageQuestion, readCursor } from '@runlith/paging';
import { AudioDevices } from '@runlith/audio/port/devices';
import { Speech } from '@runlith/speech/engine/Speech';
import type { Raised } from '@runlith/agent/permissions';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal, GateRefusal } from '../platform/contract/wire/refusal.js';
import { Settings } from '../settings/contract/service/values.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import type { Actor } from '../platform/contract/wire/actor.js';
import { type Cut, Listenings, type Place, type Recipient } from './contract/service/listenings.js';
import { type Installing, type ModelRefused, Models } from './contract/service/models.js';
import { Speaking } from './contract/service/speaking.js';
import { OPERATOR, type Span } from './contract/wire/listening.js';
import {
  CALL_HITS,
  LISTENING_ROWS,
  SPEECH_OPERATIONS as OPS,
  type SpeechOperationId,
  TRANSCRIPT_ROWS,
} from './contract/wire/operations.js';
import type { Reach } from '../projects/contract/wire/reach.js';
import { reachOf } from '../projects/reach.js';
import { callFollowEvery } from './keys.js';
import { msOfClock } from './listening/text.js';
import { statusOf } from './status.js';

const LISTING_CEILING = ceilingOf(LISTENING_ROWS);
const HITS_CEILING = ceilingOf(CALL_HITS);
const TEXT_CEILING = ceilingOf(TRANSCRIPT_ROWS);

const project = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

const listed = (reach: Reach, marked: boolean): PageQuestion => ({
  operation: 'list_listenings',
  selection: { reach, marked },
  order: LISTENING_ROWS.order,
});

const instantOf = (
  field: 'since' | 'before',
  value: string | undefined,
): Effect.Effect<number | undefined, GateRefusal<'selection-shape'>> => {
  if (value === undefined) return Effect.succeed(undefined);
  const ms = Date.parse(value);
  return Number.isNaN(ms)
    ? Effect.fail(
        new GateRefusal('selection-shape', `\`${field}\` is not an ISO instant: ${value}.`, [
          'name an ISO instant, e.g. 2026-10-02T00:00:00+02:00',
        ]),
      )
    : Effect.succeed(ms);
};

const transcript = (listening: string, window: Span | null): PageQuestion => ({
  operation: 'read_transcript',
  selection: { listening, window },
  order: TRANSCRIPT_ROWS.order,
});

const msOf = (at: string | number): number => (typeof at === 'string' ? msOfClock(at) : at);

const windowOf = (from: string | number | undefined, to: string | number | undefined): Span | null =>
  from === undefined && to === undefined
    ? null
    : { from: from === undefined ? 0 : msOf(from), to: to === undefined ? Number.MAX_SAFE_INTEGER : msOf(to) };

const placeOf = (key: readonly unknown[]): Place | null => {
  const [startedAt, id] = key;
  return key.length === 2 && typeof startedAt === 'number' && typeof id === 'string' ? { startedAt, id } : null;
};

const modelRefusal = (refused: ModelRefused) => new GateRefusal(refused.code, refused.message, ['speech_status names the local models']);

const byOf = (actor: Actor): string => {
  switch (actor.kind) {
    case 'operator':
      return OPERATOR;
    case 'thread':
      return actor.threadId;
    case 'session':
      return actor.session.key;
    case 'external':
      return actor.name;
  }
};

const ownThread = (actor: Actor): Recipient | undefined =>
  actor.kind === 'thread' ? { id: actor.threadId, projectId: actor.projectId } : undefined;

const cutOf = (input: { readonly through?: number | undefined; readonly span?: Span | undefined }): Cut =>
  input.span === undefined ? { kind: 'new', through: input.through } : { kind: 'span', span: input.span };

const installing = (models: ReadonlyArray<Installing>, model: string): readonly Raised[] => {
  const running = models.find((offered) => offered.id === model && offered.received !== null && offered.failure === null);
  return running === undefined || running.received === null
    ? []
    : [
        {
          condition: 'install-running',
          fact: `${running.label} is downloading (${running.received} of ${running.size} bytes); removing it cancels that install`,
        },
      ];
};

export const SPEECH_PAIRS: { readonly [K in SpeechOperationId]: OperationPair<(typeof OPS)[K]> } = {
  list_listenings: pair(
    OPS.list_listenings,
    body(OPS.list_listenings, {
      execute: Effect.fnUntraced(function* (input) {
        const reach = yield* reachOf(input.projects);
        const marked = input.marked === true;
        const question = listed(reach, marked);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const after = read === null ? null : placeOf(read.at);
        if (read !== null && after === null) return yield* cursorRefusal('bad-cursor');
        const shelf = yield* (yield* Listenings).list({
          reach,
          marked,
          after,
          limit: pageRows(input.limit, LISTENING_ROWS, LISTING_CEILING),
        });
        return {
          status: 'listed' as const,
          listenings: shelf.listenings,
          shown: shelf.listenings.length,
          total: shelf.total,
          next: shelf.more && shelf.last !== null ? mintCursor(question, [shelf.last.startedAt, shelf.last.id]) : null,
        };
      }),
    }),
  ),
  search_transcripts: pair(
    OPS.search_transcripts,
    body(OPS.search_transcripts, {
      execute: Effect.fnUntraced(function* (input) {
        const found = yield* (yield* Listenings).search({
          query: input.query,
          reach: yield* reachOf(input.projects),
          since: yield* instantOf('since', input.since),
          before: yield* instantOf('before', input.before),
          speaker: input.speaker,
          cursor: input.cursor,
          limit: pageRows(input.limit, CALL_HITS, HITS_CEILING),
        });
        return {
          status: 'found' as const,
          calls: found.hits,
          total: found.tally.total,
          atLeast: found.tally.atLeast,
          totalCut: found.tally.cut,
          coverage: found.coverage,
          cut: found.cut,
          cursor: found.cursor,
          approximate: found.approximate ? (true as const) : undefined,
        };
      }),
    }),
  ),
  read_transcript: pair(
    OPS.read_transcript,
    body(OPS.read_transcript, {
      execute: Effect.fnUntraced(function* (input) {
        const span = windowOf(input.from, input.to);
        const question = transcript(input.listening, span);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const [after] = read === null ? [0] : read.at;
        if (typeof after !== 'number') return yield* cursorRefusal('bad-cursor');
        const page = yield* (yield* Listenings).text({
          projectId: yield* project,
          id: input.listening,
          after,
          span,
          first: read === null,
          limit: pageRows(input.limit, TRANSCRIPT_ROWS, TEXT_CEILING),
          bytes: TEXT_CEILING * TRANSCRIPT_ROWS.rowBytes.text,
          waitMs: input.waitMs ?? 0,
        });
        return {
          status: 'read' as const,
          state: page.state,
          text: page.text,
          shown: page.shown,
          total: page.total,
          next: mintCursor(question, [page.last]),
        };
      }),
    }),
  ),
  start_listening: pair(
    OPS.start_listening,
    body(OPS.start_listening, {
      execute: Effect.fnUntraced(function* (input) {
        const listening = yield* (yield* Listenings).start({
          projectId: yield* project,
          title: input.title,
          tracks: input.tracks,
          recognizer: input.recognizer,
        });
        return { status: 'started' as const, listening };
      }),
    }),
  ),
  end_listening: pair(
    OPS.end_listening,
    body(OPS.end_listening, {
      execute: Effect.fnUntraced(function* (input) {
        const listening = yield* (yield* Listenings).end(yield* project, input.listening, input.mode);
        return { status: 'ended' as const, listening };
      }),
    }),
  ),
  finish_recognition: pair(
    OPS.finish_recognition,
    body(OPS.finish_recognition, {
      execute: Effect.fnUntraced(function* (input) {
        yield* (yield* Listenings).finishRecognition(input.id);
        return { status: 'ending' as const, id: input.id };
      }),
    }),
  ),
  mute_track: pair(
    OPS.mute_track,
    body(OPS.mute_track, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const listening = yield* (yield* Listenings).mute({
          projectId: yield* project,
          id: input.listening,
          track: input.track,
          muted: input.muted,
          by: byOf(caller.actor),
        });
        return { status: 'muted' as const, listening };
      }),
    }),
  ),
  mark_listening: pair(
    OPS.mark_listening,
    body(OPS.mark_listening, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const mark = yield* (yield* Listenings).mark({
          projectId: yield* project,
          id: input.listening,
          at: typeof input.at === 'string' ? msOfClock(input.at) : input.at,
          text: input.text,
          mark: input.mark,
          remove: input.remove,
          by: byOf(caller.actor),
        });
        return { status: 'marked' as const, mark };
      }),
    }),
  ),
  name_speaker: pair(
    OPS.name_speaker,
    body(OPS.name_speaker, {
      execute: Effect.fnUntraced(function* (input) {
        const listening = yield* (yield* Listenings).name(yield* project, input.listening, input.speaker, input.name);
        return { status: 'named' as const, listening };
      }),
    }),
  ),
  read_listening: pair(
    OPS.read_listening,
    body(OPS.read_listening, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'read' as const, detail: yield* (yield* Listenings).detail(yield* project, input.listening) };
      }),
    }),
  ),
  describe_listening: pair(
    OPS.describe_listening,
    body(OPS.describe_listening, {
      execute: Effect.fnUntraced(function* (input) {
        const listening = yield* (yield* Listenings).describe({
          projectId: yield* project,
          id: input.listening,
          title: input.title,
          summary: input.summary,
        });
        return { status: 'described' as const, listening };
      }),
    }),
  ),
  follow_listening: pair(
    OPS.follow_listening,
    body(OPS.follow_listening, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const thread = input.thread === undefined ? ownThread(caller.actor) : input.thread;
        if (thread === undefined) {
          return yield* new GateRefusal('unknown-thread', 'only a thread follows a call without naming one', [
            'name the thread that follows: `thread: {id, projectId}`',
          ]);
        }
        const minutes = input.everyMinutes ?? (yield* (yield* Settings).value(callFollowEvery));
        const listening = yield* (yield* Listenings).follow({
          projectId: yield* project,
          id: input.listening,
          thread,
          everyMs: minutes * 60_000,
        });
        return { status: 'following' as const, listening };
      }),
    }),
  ),
  recognize_listening: pair(
    OPS.recognize_listening,
    body(OPS.recognize_listening, {
      execute: Effect.fnUntraced(function* (input) {
        const listening = yield* (yield* Listenings).again({
          projectId: yield* project,
          id: input.listening,
          recognizer: input.recognizer,
          tracks: input.tracks,
        });
        return { status: 'recognizing' as const, listening };
      }),
    }),
  ),
  read_transcript_piece: pair(
    OPS.read_transcript_piece,
    body(OPS.read_transcript_piece, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'read' as const, piece: yield* (yield* Listenings).piece(yield* project, input.listening, input.span ?? null) };
      }),
    }),
  ),
  read_transcript_text: pair(
    OPS.read_transcript_text,
    body(OPS.read_transcript_text, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'read' as const, piece: yield* (yield* Listenings).pieceText(yield* project, input.listening, cutOf(input)) };
      }),
    }),
  ),
  give_transcript_piece: pair(
    OPS.give_transcript_piece,
    body(OPS.give_transcript_piece, {
      execute: Effect.fnUntraced(function* (input) {
        return {
          status: 'given' as const,
          givenThrough: yield* (yield* Listenings).give(yield* project, input.listening, cutOf(input), input.thread),
        };
      }),
    }),
  ),
  delete_listening: pair(
    OPS.delete_listening,
    body(OPS.delete_listening, {
      execute: Effect.fnUntraced(function* (input) {
        yield* (yield* Listenings).remove(yield* project, input.listening);
        return { status: 'deleted' as const, listening: input.listening };
      }),
    }),
  ),
  speak_text: pair(
    OPS.speak_text,
    body(OPS.speak_text, {
      execute: (input) =>
        Effect.map(
          Effect.flatMap(Speaking, (speaking) => speaking.speak(input)),
          (voiced) => ({ status: 'speaking' as const, ...voiced }),
        ),
    }),
  ),
  stop_speaking: pair(
    OPS.stop_speaking,
    body(OPS.stop_speaking, {
      execute: () =>
        Effect.map(
          Effect.flatMap(Speaking, (speaking) => speaking.stop),
          (voices) => ({ status: 'stopped' as const, voices }),
        ),
    }),
  ),
  speech_status: pair(
    OPS.speech_status,
    body(OPS.speech_status, {
      execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
        const mic = caller.actor.kind === 'operator' && caller.actor.deviceId !== undefined ? 'caller' : 'server';
        return {
          status: 'read' as const,
          speech: yield* statusOf(yield* Speech, yield* AudioDevices, yield* Models, yield* Settings, mic),
        };
      }),
    }),
  ),
  install_speech_model: pair(
    OPS.install_speech_model,
    body(OPS.install_speech_model, {
      execute: (input) =>
        Effect.map(
          Effect.mapError(
            Effect.flatMap(Models, (models) => models.install(input.model)),
            modelRefusal,
          ),
          (status) => ({
            status,
            model: input.model,
          }),
        ),
    }),
  ),
  remove_speech_model: pair(
    OPS.remove_speech_model,
    body(OPS.remove_speech_model, {
      prepare: (input) =>
        Effect.map(
          Effect.mapError(
            Effect.flatMap(Models, (models) => models.list),
            modelRefusal,
          ),
          (models) => installing(models, input.model),
        ),
      execute: (input) =>
        Effect.as(
          Effect.mapError(
            Effect.flatMap(Models, (models) => models.remove(input.model)),
            modelRefusal,
          ),
          {
            status: 'removed' as const,
            model: input.model,
          },
        ),
    }),
  ),
};
