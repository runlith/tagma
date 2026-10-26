import { Data, Effect, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

export class CursorRefused extends Data.TaggedError('CursorRefused')<{ readonly message: string }> {}

export const cursorGet = Effect.fn('cursor.get')(
  function* (path: string, key: string) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.get(`https://api.cursor.com/v1/${path}`).pipe(HttpClientRequest.bearerToken(key)),
    );
    if (response.status < 200 || response.status >= 300) {
      const text = yield* response.text;
      return yield* new CursorRefused({ message: `Cursor (${response.status}): ${text}` });
    }
    return yield* response.json;
  },
  Effect.mapError((cause) => (cause instanceof CursorRefused ? cause : new CursorRefused({ message: cause.message }))),
);

export const identitySchema = Schema.Struct({ userEmail: Schema.String.check(Schema.isMinLength(1)) });
export const cursorIdentity = Effect.fn('cursor.identity')(
  function* (key: string) {
    return yield* Schema.decodeUnknownEffect(identitySchema)(yield* cursorGet('me', key));
  },
  Effect.mapError((cause) => new CursorRefused({ message: cause.message })),
);
