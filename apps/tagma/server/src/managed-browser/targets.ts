import { type CommandFailure, type Connection } from '@runlith/cdp/session';
import { Effect } from 'effect';
import { type CaptureHost, type HostFailure, HostLost, HostRefused, type ProfileRecord } from '../browser/contract/service/hosts.js';
import { ProfileId } from '../browser/contract/wire/ids.js';
import { type BuildId, MANAGED } from './contract/wire/document.js';

export type Browser = { readonly connection: Connection; users: number; idleSince: number | null };

const CAPTURE = ProfileId.make('managed-capture');

export const lost = (failure: CommandFailure): HostLost =>
  new HostLost({
    message: failure._tag === 'CommandRefused' ? `${failure.method} was refused: ${failure.message}` : failure.message,
    pending: failure._tag === 'SessionEnded' && failure.pending,
  });

export const quiet =
  (where: string) =>
  <A, R>(effect: Effect.Effect<A, CommandFailure, R>): Effect.Effect<A | void, never, R> =>
    effect.pipe(
      Effect.catchTags({
        SessionEnded: () => Effect.void,
        CommandRefused: (refusal) => Effect.logDebug(`managed browser: ${where} was refused: ${refusal.message}`),
        PayloadUnreadable: (unreadable) => Effect.logWarning(`managed browser: ${where} was unreadable: ${unreadable.message}`),
        WorkerUnavailable: (gone) => Effect.logWarning(`managed browser: ${where} was not read: ${gone.message}`),
      }),
    );

export const hiddenTarget = Effect.fnUntraced(function* (browser: Browser) {
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      browser.users += 1;
    }),
    () =>
      Effect.sync(() => {
        browser.users -= 1;
        browser.idleSince = null;
      }),
  );
  const root = browser.connection.root;
  const { targetId } = yield* Effect.acquireRelease(
    root.send('Target.createTarget', { url: 'about:blank', hidden: true }).pipe(Effect.mapError(lost)),
    (created) =>
      root.send('Target.closeTarget', { targetId: created.targetId }).pipe(quiet(`closing the hidden target ${created.targetId}`)),
  );
  const { sessionId } = yield* root.send('Target.attachToTarget', { targetId, flatten: true }).pipe(Effect.mapError(lost));
  return yield* browser.connection.attach(sessionId);
});

const capturing = (build: BuildId): ProfileRecord => ({
  id: CAPTURE,
  name: 'Capture',
  adapter: MANAGED,
  document: { build },
  console: 'auto',
  removal: null,
  createdAt: new Date(0),
});

export const captureHost = (ensure: (record: ProfileRecord) => Effect.Effect<Browser, HostFailure>): CaptureHost => {
  const browser = ensure(capturing('chrome-for-testing')).pipe(
    Effect.catchTag('HostRefused', (first) =>
      ensure(capturing('installed-chrome')).pipe(
        Effect.catchTag('HostRefused', (second) =>
          Effect.fail(new HostRefused({ message: `${first.message}; ${second.message}`, unblock: [...first.unblock, ...second.unblock] })),
        ),
      ),
    ),
  );
  return {
    target: Effect.fn('ManagedHost.captureTarget')(function* (canvas) {
      yield* Effect.logInfo('capture-target acquiring browser');
      const running = yield* browser;
      yield* Effect.logInfo('capture-target acquiring session');
      const session = yield* hiddenTarget(running);
      yield* Effect.logInfo('capture-target session acquired');
      yield* session
        .send('Emulation.setDeviceMetricsOverride', {
          width: canvas.width,
          height: canvas.height,
          deviceScaleFactor: canvas.scale,
          mobile: false,
        })
        .pipe(Effect.mapError(lost));
      return session;
    }),
  };
};
