import { bytesOf } from '@runlith/cdp/payload';
import { type CdpEvent, type CommandFailure, eventParams, type Session } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Deferred, Effect, Stream } from 'effect';
import { pagePolicy } from '../artifacts/contract/wire/policy.js';
import type { FrameImage } from '../artifacts/contract/service/render.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';

const ORIGIN = 'https://page.tagma.invalid';
const DOCUMENT = `${ORIGIN}/`;

const PRESENT = `typeof window.tagmaTimeline === 'object' && window.tagmaTimeline !== null && window.tagmaTimeline.prepared instanceof Promise`;
const PAINTED = 'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))';

export type Stage = { readonly draw: (t: number) => Effect.Effect<Uint8Array, GateRefusal<'page-failed'>> };

export const pageFailed = (reason: string) =>
  new GateRefusal('page-failed', reason, ['fix the page so it gets ready and draws every frame without throwing, then draw it again']);

const thrownText = (details: Protocol.Runtime.ExceptionDetails): string => {
  const said = details.exception?.description ?? details.exception?.value ?? details.text;
  return `${String(said)} (line ${details.lineNumber + 1}, column ${details.columnNumber + 1})`;
};

export const lostPage = (failure: CommandFailure) =>
  pageFailed(
    `the browser lost the page while drawing it: ${failure._tag === 'CommandRefused' ? `${failure.method}: ${failure.message}` : failure.message}`,
  );

export const navigated = Effect.fnUntraced(
  function* (session: Session) {
    yield* session.send('Page.enable');
    yield* session.send('Runtime.enable');
    yield* session.send('Fetch.enable', { patterns: [{ urlPattern: `${ORIGIN}/*` }] });
    return yield* session.send('Page.navigate', { url: DOCUMENT });
  },
  Effect.mapError(lostPage),
  Effect.flatMap((went) =>
    went.errorText !== undefined && went.errorText !== ''
      ? Effect.fail(pageFailed(`the page did not load: ${went.errorText}`))
      : Effect.void,
  ),
);

export const serve = (session: Session, body: string, event: CdpEvent) =>
  Effect.flatMap(eventParams('Fetch.requestPaused', event), ({ requestId, request }) =>
    request.url === DOCUMENT
      ? session.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'content-type', value: 'text/html; charset=utf-8' },
            { name: 'content-security-policy', value: pagePolicy(true) },
          ],
          body,
        })
      : session.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }),
  );

export const stage = Effect.fnUntraced(function* (session: Session, body: string, image: FrameImage) {
  const loaded = yield* Deferred.make<void>();
  const failed = yield* Deferred.make<never, GateRefusal<'page-failed'>>();
  let said: string | null = null;
  const events = yield* session.events(
    (method) => method === 'Fetch.requestPaused' || method === 'Runtime.exceptionThrown' || method === 'Page.loadEventFired',
  );
  yield* Stream.runForEach(events, (event) => {
    if (event.child !== undefined) return Effect.void;
    switch (event.method) {
      case 'Fetch.requestPaused':
        return serve(session, body, event);
      case 'Runtime.exceptionThrown':
        return Effect.flatMap(eventParams('Runtime.exceptionThrown', event), ({ exceptionDetails }) => {
          said ??= thrownText(exceptionDetails);
          return Deferred.fail(failed, pageFailed(`the page threw before it was ready: ${said}`));
        });
      default:
        return Deferred.succeed(loaded, undefined);
    }
  }).pipe(
    Effect.mapError(lostPage),
    Effect.andThen(Effect.fail(pageFailed('the browser closed the page before it was drawn'))),
    Effect.catchTag('GateRefusal', (refusal) => Deferred.fail(failed, refusal)),
    Effect.forkScoped,
  );

  const thrownFirst = () => said;

  const evaluate = (expression: string) =>
    session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).pipe(Effect.mapError(lostPage));

  const ready = Effect.gen(function* () {
    yield* Deferred.await(loaded);
    const present = yield* evaluate(PRESENT);
    if (present.result.value !== true) {
      const first = thrownFirst();
      return yield* pageFailed(
        first === null
          ? 'the page has no window.tagmaTimeline once it loaded: the timeline fragment is missing, or the page stopped before it ran'
          : `the page threw before it was ready: ${first}`,
      );
    }
    const prepared = yield* evaluate('window.tagmaTimeline.prepared.then(() => true)');
    if (prepared.exceptionDetails !== undefined)
      return yield* pageFailed(`the page failed to get ready: ${thrownText(prepared.exceptionDetails)}`);
  });

  yield* navigated(session);
  yield* Effect.raceFirst(ready, Deferred.await(failed));

  const shot = image.format === 'png' ? ({ format: 'png' } as const) : ({ format: 'jpeg', quality: image.quality } as const);

  return {
    draw: Effect.fnUntraced(function* (t: number) {
      const sought = yield* evaluate(`window.tagmaTimeline.seek(${t})`);
      if (sought.exceptionDetails !== undefined)
        return yield* pageFailed(`the frame at ${t} s threw: ${thrownText(sought.exceptionDetails)}`);
      yield* evaluate(PAINTED);
      const text = yield* session.reply('Page.captureScreenshot', shot).pipe(Effect.mapError(lostPage));
      return yield* bytesOf(text).pipe(Effect.mapError((failure) => pageFailed(`the frame could not be read: ${failure.message}`)));
    }),
  } satisfies Stage;
});
