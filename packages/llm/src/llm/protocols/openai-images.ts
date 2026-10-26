import { Effect, Schedule, Schema } from 'effect';
import { Headers, type HttpClientResponse } from 'effect/http';
import type { GeneratedImage, ImageRequest } from '../../profiles/images';
import * as Auth from '../route/auth';
import { HttpExecutor, normalizedHeaders } from '../route/executor';
import { InvalidProviderOutputReason, LLMError } from '../schema/errors';
import { namedHeaders } from '../utils/headers';
import * as ProviderShared from './shared';

export type ImagesRoute = {
  readonly baseURL: string;
  readonly auth: Auth.Auth;
  readonly recover: Effect.Effect<void, LLMError> | undefined;
  readonly fields: Readonly<Record<string, unknown>>;
};

export type ImagesReply = {
  readonly images: readonly GeneratedImage[];
  readonly requestId: string | undefined;
  readonly headers: Headers.Headers;
};

export const GENERATIONS = '/images/generations';
export const EDITS = '/images/edits';

const ImagesAnswer = Schema.Struct({
  data: Schema.Array(Schema.Struct({ b64_json: Schema.optional(Schema.String) })),
  output_format: Schema.optional(Schema.String),
});
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(ImagesAnswer));

const FORMATS: Readonly<Record<string, string>> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp' };

const malformed = (message: string) =>
  new LLMError({ module: 'OpenAIImages', method: 'generate', reason: new InvalidProviderOutputReason({ message }) });

const dataUrl = (image: ImageRequest['images'][number]): string =>
  `data:${image.mediaType};base64,${Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength).toString('base64')}`;

export const imagesBody = (fields: ImagesRoute['fields'], request: ImageRequest): string =>
  JSON.stringify({
    ...(request.images.length === 0 ? {} : { images: request.images.map((image) => ({ image_url: dataUrl(image) })) }),
    prompt: request.prompt,
    background: request.transparent ? 'transparent' : 'opaque',
    model: request.model,
    ...fields,
  });

const answered = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<ImagesReply, LLMError> =>
  response.text.pipe(
    Effect.flatMap(decodeAnswer),
    Effect.mapError((failure) => malformed(`The images answer could not be read: ${failure.message}`)),
    Effect.flatMap((answer) => {
      const mediaType = FORMATS[answer.output_format ?? 'png'];
      if (mediaType === undefined) return Effect.fail(malformed(`The images answer names an unknown format ${answer.output_format}.`));
      const images = answer.data.flatMap((image) =>
        image.b64_json === undefined ? [] : [{ bytes: new Uint8Array(Buffer.from(image.b64_json, 'base64')), mediaType }],
      );
      if (images.length === 0) return Effect.fail(malformed('The images answer carried no picture.'));
      const headers = normalizedHeaders(response.headers);
      return Effect.succeed({
        images,
        requestId: headers['x-request-id'] ?? headers['x-oai-request-id'],
        headers: Headers.fromInput(headers),
      });
    }),
  );

export const generateImages = Effect.fn('OpenAIImages.generate')(function* (route: ImagesRoute, request: ImageRequest) {
  const executor = yield* HttpExecutor;
  const url = `${route.baseURL}${request.images.length === 0 ? GENERATIONS : EDITS}`;
  const body = imagesBody(route.fields, request);
  const once = Effect.gen(function* () {
    const headers = yield* Auth.toEffect(route.auth)({
      method: 'POST',
      url,
      body,
      headers: namedHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    });
    return yield* Effect.scopedWith((lifetime) =>
      Effect.flatMap(executor.execute(ProviderShared.jsonPost({ url, body, headers }), lifetime), answered),
    );
  });
  const recovery = Schedule.recurs(1).pipe(
    Schedule.while(({ input }: Schedule.Metadata<number, LLMError>) => Effect.succeed(input.status === 401 && route.recover !== undefined)),
    Schedule.tap(() => route.recover ?? Effect.void),
  );
  return yield* Effect.retry(once, recovery);
});
