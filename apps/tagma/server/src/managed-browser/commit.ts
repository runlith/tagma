import { type CdpEvent, eventParams } from '@runlith/cdp/session';
import { Effect, Stream } from 'effect';

export const committed = Effect.fnUntraced(function* (target: string, stream: Stream.Stream<CdpEvent>, loader: string | undefined | null) {
  let started = false;
  const arrived = yield* stream.pipe(
    Stream.filter((event) => event.child === undefined),
    Stream.mapEffect(
      Effect.fnUntraced(function* (event: CdpEvent) {
        switch (event.method) {
          case 'Page.frameNavigated': {
            const { frame } = yield* eventParams('Page.frameNavigated', event);
            return frame.parentId === undefined && (loader === null || frame.loaderId === loader)
              ? { url: `${frame.url}${frame.urlFragment ?? ''}` }
              : null;
          }
          case 'Page.navigatedWithinDocument': {
            const { frameId, url } = yield* eventParams('Page.navigatedWithinDocument', event);
            return frameId === target && (loader === null || loader === undefined) ? { url } : null;
          }
          case 'Page.frameStartedLoading':
            started = true;
            return null;
          case 'Page.frameStoppedLoading':
            return started ? { url: undefined } : null;
          case 'Page.javascriptDialogClosed': {
            const { result } = yield* eventParams('Page.javascriptDialogClosed', event);
            return result ? null : { url: undefined };
          }
          default:
            return null;
        }
      }),
    ),
    Stream.filter((found) => found !== null),
    Stream.runHead,
  );
  return arrived._tag === 'Some' ? arrived.value.url : undefined;
});
