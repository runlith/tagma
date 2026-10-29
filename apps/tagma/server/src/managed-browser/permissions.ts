import { eventParams, type Session } from '@runlith/cdp/session';
import { Effect, Schema, type Scope, Semaphore, Stream } from 'effect';
import { type HostFailure, HostRefused } from '../browser/contract/service/hosts.js';
import { lost, quiet } from './targets.js';

const LocationPermission = Schema.Struct({
  origin: Schema.String,
  setting: Schema.Literals(['granted', 'denied', 'prompt']),
});
type LocationPermission = typeof LocationPermission.Type;

type Grant = { readonly setting: LocationPermission['setting']; holds: number };

type Lease = { readonly refresh: Effect.Effect<void, HostFailure> };

export type Permissions = {
  readonly geolocation: (service: Session) => Effect.Effect<void, HostFailure, Scope.Scope>;
  readonly synchronize: (service: Session) => Effect.Effect<void, HostFailure>;
};

export const makePermissions = Effect.fnUntraced(function* (input: { readonly browser: Session }) {
  const { browser } = input;
  const grants = new Map<string, Grant>();
  const leases = new Map<Session, Set<Lease>>();
  const lock = yield* Semaphore.make(1);

  const inspect = Effect.fnUntraced(function* (service: Session) {
    const { frameTree } = yield* service.send('Page.getFrameTree').pipe(Effect.mapError(lost));
    const { executionContextId } = yield* service
      .send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'host-permissions' })
      .pipe(Effect.mapError(lost));
    const { result } = yield* service
      .send('Runtime.evaluate', {
        expression: `(async () => ({ origin: location.origin, setting: (await navigator.permissions.query({name: 'geolocation'})).state }))()`,
        contextId: executionContextId,
        awaitPromise: true,
        returnByValue: true,
      })
      .pipe(Effect.mapError(lost));
    return yield* Schema.decodeUnknownEffect(LocationPermission)(result.value).pipe(
      Effect.mapError(
        (failure) =>
          new HostRefused({
            message: `the page's geolocation permission could not be read: ${failure.message}`,
            unblock: ['navigate to an http or https page'],
          }),
      ),
    );
  });

  const acquire = Effect.fnUntraced(function* ({ origin, setting }: LocationPermission) {
    if (origin === 'null')
      return yield* new HostRefused({
        message: 'this page has no origin to grant geolocation',
        unblock: ['navigate to an http or https page'],
      });
    const held = grants.get(origin);
    if (held !== undefined) {
      held.holds += 1;
      return;
    }
    yield* browser
      .send('Browser.setPermission', { permission: { name: 'geolocation' }, origin, setting: 'granted' })
      .pipe(Effect.mapError(lost));
    grants.set(origin, { setting, holds: 1 });
  });

  const release = Effect.fnUntraced(function* (origin: string) {
    const held = grants.get(origin);
    if (held === undefined || --held.holds > 0) return;
    yield* browser
      .send('Browser.setPermission', { permission: { name: 'geolocation' }, origin, setting: held.setting })
      .pipe(Effect.ensuring(Effect.sync(() => grants.delete(origin))), quiet(`restoring geolocation permission for ${origin}`));
  });

  return {
    geolocation: Effect.fnUntraced(function* (service: Session) {
      const events = yield* service.events((method) => method === 'Page.frameNavigated');
      let origin: string | null = null;
      let active = true;
      const refresh = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (!active) return;
          const permission = yield* restore(inspect(service));
          if (permission.origin === origin) return;
          if (origin !== null) {
            yield* release(origin);
            origin = null;
          }
          yield* acquire(permission);
          origin = permission.origin;
        }),
      ).pipe(Semaphore.withPermit(lock));
      const lease: Lease = { refresh };
      yield* Effect.acquireRelease(
        Effect.andThen(
          refresh,
          Effect.sync(() => {
            const held = leases.get(service) ?? new Set<Lease>();
            held.add(lease);
            leases.set(service, held);
          }),
        ),
        () =>
          Effect.gen(function* () {
            active = false;
            const held = leases.get(service);
            held?.delete(lease);
            if (held?.size === 0) leases.delete(service);
            if (origin !== null) yield* release(origin);
          }).pipe(Semaphore.withPermit(lock)),
      );
      yield* Stream.runForEach(events, (event) =>
        Effect.gen(function* () {
          if (event.child !== undefined) return;
          const { frame } = yield* eventParams('Page.frameNavigated', event);
          if (frame.parentId !== undefined) return;
          yield* refresh;
        }).pipe(
          Effect.catchTags({
            HostLost: (failure) => Effect.logWarning(`managed browser: geolocation grant did not follow navigation: ${failure.message}`),
            HostRefused: (failure) => Effect.logWarning(`managed browser: geolocation grant did not follow navigation: ${failure.message}`),
            PayloadUnreadable: (failure) => Effect.logWarning(`managed browser: geolocation navigation was unreadable: ${failure.message}`),
            WorkerUnavailable: (failure) => Effect.logWarning(`managed browser: geolocation navigation was unreadable: ${failure.message}`),
          }),
        ),
      ).pipe(Effect.forkScoped);
    }),
    synchronize: Effect.fn('ManagedHost.synchronizePermissions')(function* (service: Session) {
      yield* Effect.forEach(leases.get(service) ?? [], (lease) => lease.refresh, { discard: true });
    }),
  } satisfies Permissions;
});
