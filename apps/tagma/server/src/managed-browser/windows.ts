import type { CommandFailure, Session } from '@runlith/cdp/session';
import { Effect } from 'effect';
import type { WindowMode } from './contract/wire/document.js';

export type Windows = {
  readonly page: { readonly url: string; readonly newWindow: boolean };
  readonly remember: (target: string) => Effect.Effect<void, CommandFailure>;
};

const HIDDEN: Windows = { page: { url: 'about:blank', newWindow: false }, remember: () => Effect.void };

export const makeWindows = Effect.fnUntraced(function* (input: {
  readonly browser: Session;
  readonly own: string;
  readonly mode: WindowMode;
}): Effect.fn.Return<Windows, CommandFailure> {
  const { browser, own, mode } = input;
  if (mode === 'hidden') return HIDDEN;
  const { windowId } = yield* browser.send('Browser.getWindowForTarget', { targetId: own });

  const remember = Effect.fnUntraced(function* (target: string) {
    const { bounds } = yield* browser.send('Browser.getWindowForTarget', { targetId: target });
    if (bounds.windowState === 'minimized') return;
    if (bounds.windowState !== 'normal') {
      yield* browser.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
      return;
    }
    yield* browser.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    yield* browser.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
    });
  });

  return { page: { url: 'about:blank', newWindow: true }, remember };
});
