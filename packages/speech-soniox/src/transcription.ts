import type { Recorded } from '@runlith/speech/protocol/adapter';
import type { RecognitionModel } from '@runlith/speech/wire/capabilities';
import { type FileEvent, SpeechEvent } from '@runlith/speech/wire/events';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import { Clock, Effect, Exit, Option, Schedule, Schema, Stream } from 'effect';
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http';
import type { Credential } from './credential.ts';
import { failureOf, Token, unitOf } from './frames.ts';

export const API = 'https://api.soniox.com';

const FIRST_STEP_MS = 2_000;
const LAST_STEP_MS = 10_000;
const HEADROOM_MS = 5 * 60_000;
const STUMBLES = 3;
const ANSWER_MS = 60_000;

const Created = Schema.Struct({ id: Schema.String });

const Status = Schema.Struct({
  status: Schema.String,
  error_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  error_message: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
type Status = typeof Status.Type;

const Transcript = Schema.Struct({ tokens: Schema.Array(Token) });

const Ticket = Schema.Struct({ transcription: Schema.String, file: Schema.String, rate: Schema.Number, ms: Schema.Number });
type Ticket = typeof Ticket.Type;

type Session = { readonly client: HttpClient.HttpClient; readonly credential: Credential };

const ok = (response: HttpClientResponse.HttpClientResponse): boolean => response.status >= 200 && response.status < 300;

const sent = (session: Session, request: HttpClientRequest.HttpClientRequest) =>
  session.client.execute(HttpClientRequest.setHeaders(request, { authorization: `Bearer ${session.credential.apiKey}` })).pipe(
    Effect.mapError((failure) => SpeechFailure.transport(`Soniox could not be reached: ${failure.message}`)),
    Effect.withSpan('soniox.transcription.send'),
  );

const reached = (session: Session, request: HttpClientRequest.HttpClientRequest) =>
  sent(session, request).pipe(
    Effect.timeoutOption(ANSWER_MS),
    Effect.flatMap((answer) =>
      Option.isSome(answer) ? Effect.succeed(answer.value) : Effect.fail(SpeechFailure.transport('Soniox did not answer in time')),
    ),
  );

const said = (json: unknown, key: string): string | undefined => {
  if (typeof json !== 'object' || json === null) return undefined;
  const value = (json as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' ? value : undefined;
};

const refusalOf = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<never, SpeechFailure> =>
  Effect.flatMap(
    Effect.mapError(response.json, () => failureOf({ error_code: response.status })),
    (json) =>
      Effect.fail(
        failureOf({
          error_code: response.status,
          error_type: said(json, 'error_type'),
          error_message: said(json, 'message'),
          request_id: said(json, 'request_id'),
        }),
      ),
  );

const answered = Effect.fn('soniox.transcription.answer')(function* <A>(
  schema: Schema.Decoder<A>,
  response: HttpClientResponse.HttpClientResponse,
  what: string,
): Effect.fn.Return<A, SpeechFailure> {
  if (!ok(response)) return yield* refusalOf(response);
  const json = yield* Effect.mapError(response.json, (failure) =>
    SpeechFailure.provider(`Soniox answered ${what} with a body that is not JSON: ${failure.message}`, false),
  );
  return yield* Effect.mapError(Schema.decodeUnknownEffect(schema)(json), (failure) =>
    SpeechFailure.provider(`Soniox answered ${what} in an unknown shape: ${failure.message}`, false),
  );
});

const nameOf = (mime: string): string => (mime === 'audio/ogg' ? 'recording.ogg' : mime === 'audio/wav' ? 'recording.wav' : 'recording');

const uploaded = (session: Session, recorded: Recorded): Effect.Effect<string, SpeechFailure> => {
  const boundary = `runlith-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="client_reference_id"\r\n\r\n${recorded.reference}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${nameOf(recorded.mime)}"\r\nContent-Type: ${recorded.mime}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = Stream.make(head).pipe(Stream.concat(recorded.bytes), Stream.concat(Stream.make(tail)));
  const request = HttpClientRequest.post(`${API}/v1/files`).pipe(
    HttpClientRequest.bodyStream(body, {
      contentType: `multipart/form-data; boundary=${boundary}`,
      contentLength: head.length + recorded.size + tail.length,
    }),
  );
  return Effect.map(
    Effect.flatMap(sent(session, request), (response) => answered(Created, response, 'the upload')),
    (created) => created.id,
  );
};

const created = (
  session: Session,
  model: RecognitionModel,
  file: string,
  recorded: Recorded,
  request: RecognitionRequest,
): Effect.Effect<string, SpeechFailure> => {
  const body = {
    model: model.id,
    file_id: file,
    enable_speaker_diarization: request.speakers,
    enable_language_identification: request.detect,
    language_hints: request.languages.length === 0 ? undefined : request.languages,
    client_reference_id: recorded.reference,
  };
  const http = HttpClientRequest.post(`${API}/v1/transcriptions`).pipe(HttpClientRequest.bodyJsonUnsafe(body));
  return Effect.map(
    Effect.flatMap(reached(session, http), (response) => answered(Created, response, 'the transcription')),
    (made) => made.id,
  );
};

const removing = HttpClientRequest.make('DELETE');

const statusOf = (session: Session, ticket: Ticket): Effect.Effect<Status, SpeechFailure> =>
  Effect.flatMap(reached(session, HttpClientRequest.get(`${API}/v1/transcriptions/${ticket.transcription}`)), (response) =>
    answered(Status, response, 'the transcription status'),
  );

const ended = (status: Status): boolean => status.status === 'completed' || status.status === 'error';

const awaited = Effect.fn('soniox.transcription.awaited')(function* (
  session: Session,
  ticket: Ticket,
): Effect.fn.Return<Status, SpeechFailure> {
  const deadline = (yield* Clock.currentTimeMillis) + ticket.ms + HEADROOM_MS;
  let step = FIRST_STEP_MS;
  const delay = Effect.gen(function* () {
    if ((yield* Clock.currentTimeMillis) + step > deadline)
      return yield* SpeechFailure.transport('Soniox did not finish the transcription in time');
    const waiting = step;
    step = Math.min(LAST_STEP_MS, Math.round(step * 1.5));
    return waiting;
  });
  const retry = Schedule.recurs(STUMBLES).pipe(
    Schedule.while(({ input }: Schedule.Metadata<number, SpeechFailure>) => Effect.succeed(input.retryable)),
    Schedule.addDelay(() => delay),
  );
  while (true) {
    const status = yield* Effect.retry(statusOf(session, ticket), retry);
    if (ended(status)) return status;
    yield* Effect.sleep(yield* delay);
  }
});

const gone = (session: Session, request: HttpClientRequest.HttpClientRequest): Effect.Effect<number, SpeechFailure> =>
  Effect.flatMap(reached(session, request), (answer) =>
    ok(answer) || answer.status === 404 || answer.status === 409 ? Effect.succeed(answer.status) : refusalOf(answer),
  );

const fileGone = (session: Session, file: string): Effect.Effect<void, SpeechFailure> =>
  Effect.asVoid(gone(session, removing(`${API}/v1/files/${file}`)));

const transcriptionGone = Effect.fn('soniox.transcription.remove')(function* (session: Session, ticket: Ticket) {
  const transcription = removing(`${API}/v1/transcriptions/${ticket.transcription}`);
  if ((yield* gone(session, transcription)) !== 409) return;
  yield* awaited(session, ticket);
  if ((yield* gone(session, transcription)) === 409)
    return yield* Effect.fail(SpeechFailure.provider('Soniox still processes the transcription it was asked to remove', true));
});

const removed = (session: Session, ticket: Ticket): Effect.Effect<void, SpeechFailure> =>
  Effect.flatMap(Effect.result(transcriptionGone(session, ticket)), (transcription) =>
    Effect.andThen(fileGone(session, ticket.file), Effect.fromResult(transcription)),
  );

const tidied = (removal: Effect.Effect<void, SpeechFailure>, held: Readonly<Record<string, string>>): Effect.Effect<void> =>
  removal.pipe(
    Effect.catchTag('SpeechFailure', (failure) =>
      Effect.logWarning('Soniox keeps work it was asked to remove', { ...held, reason: failure.message }),
    ),
  );

const tidy = (session: Session, ticket: Ticket): Effect.Effect<void> =>
  tidied(removed(session, ticket), { transcription: ticket.transcription, file: ticket.file });

const eventsOf = (tokens: ReadonlyArray<Token>, rate: number): ReadonlyArray<FileEvent> => {
  const units = tokens.filter((token) => token.is_audio_event !== true && token.translation_status !== 'translation');
  if (units.length === 0) return [SpeechEvent.finished];
  return [
    SpeechEvent.final(
      '0',
      units.map((token) => unitOf(token, rate)),
    ),
    SpeechEvent.turnEnd('0'),
    SpeechEvent.finished,
  ];
};

const followed = (session: Session, ticket: Ticket): Stream.Stream<FileEvent, SpeechFailure> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const status = yield* awaited(session, ticket);
      if (status.status === 'error') {
        return yield* Effect.fail(
          failureOf({
            error_type: status.error_type ?? undefined,
            error_message: status.error_message ?? 'Soniox could not transcribe it',
          }),
        );
      }
      const transcript = yield* Effect.flatMap(
        reached(session, HttpClientRequest.get(`${API}/v1/transcriptions/${ticket.transcription}/transcript`)),
        (response) => answered(Transcript, response, 'the transcript'),
      );
      return Stream.fromIterable(eventsOf(transcript.tokens, ticket.rate));
    }).pipe(Effect.tapError(() => tidy(session, ticket))),
  ).pipe(Stream.concat(Stream.fromEffectDrain(tidy(session, ticket))));

const tokenOf = (ticket: Ticket): string => JSON.stringify(ticket);

const ticketOf = (token: string): Effect.Effect<Ticket, SpeechFailure> =>
  Effect.mapError(Effect.fromResult(Schema.decodeUnknownResult(Schema.fromJsonString(Ticket))(token)), () =>
    SpeechFailure.invalidRequest('the token does not name a Soniox transcription'),
  );

const sessionOf = (credential: Credential): Effect.Effect<Session, never, HttpClient.HttpClient> =>
  Effect.map(HttpClient.HttpClient, (client) => ({ client, credential }));

export const transcribed = (
  model: RecognitionModel,
  recorded: Recorded,
  request: RecognitionRequest,
  credential: Credential,
): Stream.Stream<FileEvent, SpeechFailure, HttpClient.HttpClient> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const session = yield* sessionOf(credential);
      const ticket = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const file = yield* restore(uploaded(session, recorded));
          const transcription = yield* restore(created(session, model, file, recorded, request)).pipe(
            Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : tidied(fileGone(session, file), { file }))),
          );
          return { transcription, file, rate: recorded.format.rate, ms: recorded.durationMs };
        }),
      );
      const job: FileEvent = { _tag: 'Job', token: tokenOf(ticket) };
      return Stream.make(job).pipe(Stream.concat(followed(session, ticket)));
    }),
  );

export const resumed = (token: string, credential: Credential): Stream.Stream<FileEvent, SpeechFailure, HttpClient.HttpClient> =>
  Stream.unwrap(Effect.map(Effect.all([sessionOf(credential), ticketOf(token)]), ([session, ticket]) => followed(session, ticket)));

export const discarded = (token: string, credential: Credential): Effect.Effect<void, SpeechFailure, HttpClient.HttpClient> =>
  Effect.flatMap(Effect.all([sessionOf(credential), ticketOf(token)]), ([session, ticket]) => removed(session, ticket));
