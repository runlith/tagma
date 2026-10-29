import type { CommandFailure } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Effect, Scope } from 'effect';
import type { Attached, Paged } from './drive.js';
import type { Box } from './target.js';

const LINGER = '2 seconds';

const AMBER = { r: 242, g: 165, b: 72 };
const INK = { r: 23, g: 23, b: 23, a: 0.9 };

export type Mark = { readonly kind: 'point'; readonly x: number; readonly y: number } | { readonly kind: 'box'; readonly box: Box };

export const PICKING: Protocol.Overlay.HighlightConfig = {
  showInfo: true,
  contentColor: { r: 111, g: 168, b: 220, a: 0.5 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.7 },
};

const arrow = (x: number, y: number): number[] => [x, y, x, y + 20, x + 5.5, y + 14.5, x + 14, y + 14];

const corners = ({ x, y, width, height }: Box): number[] => [x, y, x + width, y, x + width, y + height, x, y + height];

const draw = (attached: Attached, mark: Mark) =>
  mark.kind === 'point'
    ? attached.session.post('Overlay.highlightQuad', { quad: arrow(mark.x, mark.y), color: { ...AMBER, a: 1 }, outlineColor: INK })
    : attached.session.post('Overlay.highlightQuad', {
        quad: corners(mark.box),
        color: { ...AMBER, a: 0.14 },
        outlineColor: { ...AMBER, a: 1 },
      });

export const erase = (attached: Attached): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (attached.cursor === null) return Effect.void;
    attached.cursor = null;
    return attached.session.post('Overlay.hideHighlight');
  });

export const mark = Effect.fnUntraced(function* (state: Paged, attached: Attached, shown: Mark): Effect.fn.Return<void, CommandFailure> {
  if (state.picking > 0) return;
  if (!attached.overlaid) {
    attached.overlaid = true;
    yield* Scope.provide(attached.domains.enable('Overlay'), attached.scope).pipe(
      Effect.catchTag('CommandRefused', (refused) =>
        Effect.logInfo(`browser: page ${attached.page} draws no agent cursor: ${refused.method}: ${refused.message}`),
      ),
    );
  }
  attached.cursor = shown;
  yield* draw(attached, shown);
});

export const fade = (attached: Attached): Effect.Effect<void> =>
  Effect.suspend(() => {
    const shown = attached.cursor;
    if (shown === null) return Effect.void;
    return Effect.sleep(LINGER).pipe(
      Effect.andThen(Effect.suspend(() => (attached.cursor === shown ? erase(attached) : Effect.void))),
      Effect.forkIn(attached.scope),
      Effect.asVoid,
    );
  });

export const unmarked = <A, E>(state: Paged, attached: Attached, capture: Effect.Effect<A, E>): Effect.Effect<A, E | CommandFailure> =>
  Effect.suspend(() => {
    const shown = attached.cursor;
    const picking = state.picking > 0;
    if (shown === null && !picking) return capture;
    const restore = Effect.suspend(() => {
      if (state.picking > 0) return attached.session.post('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: PICKING });
      return shown !== null && attached.cursor === shown ? draw(attached, shown) : Effect.void;
    });
    return Effect.gen(function* () {
      if (picking) yield* attached.session.send('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} });
      else yield* attached.session.send('Overlay.hideHighlight');
      return yield* capture;
    }).pipe(Effect.ensuring(restore));
  });
