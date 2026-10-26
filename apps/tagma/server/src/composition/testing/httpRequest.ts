import { Effect } from 'effect';
import { HttpEffect, HttpMiddleware, HttpServerRequest, HttpServerResponse } from 'effect/http';

export type HttpAnswer = { readonly status: number; readonly body: unknown };

export const requestEffect = Effect.fnUntraced(function* <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  request: Request,
) {
  let answer!: HttpAnswer;
  yield* HttpEffect.toHandled(
    handler,
    (_request, response) =>
      Effect.gen(function* () {
        const web = HttpServerResponse.toWeb(response, {
          withoutBody: request.method === 'HEAD',
          context: yield* Effect.context<never>(),
        });
        const body = yield* Effect.promise(() => web.json().catch(() => null));
        answer = { status: response.status, body };
      }),
    HttpMiddleware.logger,
  ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)));
  return answer;
});
