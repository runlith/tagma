import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import type { CredentialFile } from './CredentialFile';
import { makeRefreshFlight, type RefreshRequest } from './RefreshFlight';

type Grant = { readonly token: string; readonly bearer: string };
type Doc = { readonly grant: Grant; readonly label: string };

const setup = () => {
  let document: Doc = { grant: { token: 'initial', bearer: 'expired' }, label: 'account' };
  const file: CredentialFile<Doc> = {
    read: () => Effect.sync(() => document),
    readFresh: () => Effect.sync(() => document),
    update: (change) =>
      Effect.flatMap(change(document), (next) =>
        Effect.sync(() => {
          document = next;
        }),
      ),
  };
  const flight = makeRefreshFlight({ file });
  const request = (refresh: RefreshRequest<Doc, Grant, never>['refresh']): RefreshRequest<Doc, Grant, never> => ({
    grant: (current) => Effect.succeed(current.grant),
    identity: (grant) => grant.token,
    needed: (grant) => Effect.succeed(grant.bearer === 'expired'),
    refresh,
    replace: (current, grant) => Effect.succeed({ ...current, grant }),
  });
  return { file, flight, request };
};

it.effect('concurrent callers exchange a rotating grant once and all read the replacement', () =>
  Effect.gen(function* () {
    const { file, flight, request } = setup();
    const began = yield* Deferred.make<void>();
    const exchange = yield* Deferred.make<void>();
    let exchanges = 0;
    const refresh = request(() =>
      Effect.sync(() => {
        exchanges += 1;
      }).pipe(
        Effect.andThen(Deferred.succeed(began, undefined)),
        Effect.andThen(Deferred.await(exchange)),
        Effect.as({ token: 'rotated', bearer: 'renewed' }),
      ),
    );
    const first = yield* Effect.forkScoped(flight.run('account', Effect.succeed(refresh)).pipe(Effect.andThen(file.read)));
    yield* Deferred.await(began);
    const second = yield* Effect.forkScoped(flight.run('account', Effect.succeed(refresh)).pipe(Effect.andThen(file.read)));
    yield* Deferred.succeed(exchange, undefined);
    expect((yield* Fiber.join(first)).grant).toEqual({ token: 'rotated', bearer: 'renewed' });
    expect((yield* Fiber.join(second)).grant).toEqual({ token: 'rotated', bearer: 'renewed' });
    expect(exchanges).toBe(1);
  }),
);

it.effect('a changed grant is not overwritten by the exchange that started before it', () =>
  Effect.gen(function* () {
    const { file, flight, request } = setup();
    const began = yield* Deferred.make<void>();
    const exchange = yield* Deferred.make<void>();
    const refreshing = yield* Effect.forkScoped(
      flight.run(
        'account',
        Effect.succeed(
          request(() =>
            Deferred.succeed(began, undefined).pipe(
              Effect.andThen(Deferred.await(exchange)),
              Effect.as({ token: 'rotated', bearer: 'from-old-grant' }),
            ),
          ),
        ),
      ),
    );
    yield* Deferred.await(began);
    const replacement = { grant: { token: 'new-sign-in', bearer: 'current' }, label: 'renamed' };
    yield* file.update(() => Effect.succeed(replacement));
    yield* Deferred.succeed(exchange, undefined);
    yield* Fiber.join(refreshing);
    expect(yield* file.read()).toEqual(replacement);
  }),
);
