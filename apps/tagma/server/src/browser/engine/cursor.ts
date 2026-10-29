import { type CommandFailure, isCommandFailure } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Effect, Exit, Result, Scope } from 'effect';
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

const inspectMode = Effect.fnUntraced(function* (
  attached: Attached,
  enabled: boolean,
  targets: readonly (string | undefined)[] = [undefined, ...attached.children.keys()],
) {
  const results = yield* Effect.forEach(
    targets.filter((child) => attached.domains.held('Overlay', child)),
    (child) =>
      attached.session
        .send('Overlay.setInspectMode', { mode: enabled ? 'searchForNode' : 'none', highlightConfig: enabled ? PICKING : {} }, child)
        .pipe(Effect.result),
  );
  for (const result of results) if (Result.isFailure(result)) return yield* Effect.fail(result.failure);
});

const holdOverlay = Effect.fnUntraced(function* (attached: Attached, child: string | undefined) {
  if (attached.domains.held('Overlay', child)) return;
  const scope = child === undefined ? attached.scope : attached.adopted.get(child);
  if (scope !== undefined) yield* Scope.provide(attached.domains.enable('Overlay', child), scope);
});

export const adoptPicking = (state: Paged, attached: Attached, child: string) =>
  attached.overlaying.withPermits(1)(
    Effect.gen(function* () {
      if (state.picking === 0) return;
      yield* holdOverlay(attached, child);
      yield* inspectMode(attached, true, [child]);
    }),
  );

export const picking = (state: Paged, attached: Attached) =>
  Effect.acquireRelease(
    attached.overlaying.withPermits(1)(
      Effect.gen(function* () {
        yield* holdOverlay(attached, undefined);
        for (const child of attached.children.keys()) {
          if (attached.domains.held('DOM', child)) yield* holdOverlay(attached, child);
        }
        yield* inspectMode(attached, true);
        state.picking += 1;
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && state.picking === 0
            ? inspectMode(attached, false).pipe(
                Effect.catchIf(isCommandFailure, (failure) =>
                  Effect.logDebug(`browser: a partial pick on ${attached.page} could not be cleared: ${failure.message}`),
                ),
              )
            : Effect.void,
        ),
      ),
    ),
    () =>
      attached.overlaying.withPermits(1)(
        Effect.gen(function* () {
          state.picking -= 1;
          if (state.picking > 0 || state.attached !== attached) return;
          yield* inspectMode(attached, false).pipe(
            Effect.catchIf(isCommandFailure, (failure) =>
              Effect.logDebug(`browser: inspect mode on ${attached.page} could not be ended: ${failure.message}`),
            ),
          );
        }),
      ),
  );

export const unmarked = <A, E>(state: Paged, attached: Attached, capture: Effect.Effect<A, E>): Effect.Effect<A, E | CommandFailure> =>
  attached.overlaying.withPermits(1)(
    Effect.suspend(() => {
      const shown = attached.cursor;
      const picking = state.picking > 0;
      if (shown === null && !picking) return capture;
      const restore = Effect.suspend(() => {
        if (state.picking > 0)
          return inspectMode(attached, true).pipe(
            Effect.catchIf(isCommandFailure, (failure) =>
              Effect.logWarning(`browser: inspect mode on ${attached.page} could not be restored after capture: ${failure.message}`),
            ),
          );
        return shown !== null && attached.cursor === shown ? draw(attached, shown) : Effect.void;
      });
      return Effect.gen(function* () {
        if (picking) yield* inspectMode(attached, false);
        else yield* attached.session.send('Overlay.hideHighlight');
        return yield* capture;
      }).pipe(Effect.ensuring(restore));
    }),
  );
