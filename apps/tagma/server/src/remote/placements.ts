import { Duration, Effect, FiberHandle, PubSub, Queue, Stream } from 'effect';
import { Exposure, type SiteKeeping } from './contract/service/exposure.js';
import { WantedSites } from './contract/service/sites.js';
import type { AccessState, Blocked } from './contract/wire/access.js';
import { Ledger } from './store/ledger.js';

const SETTING_UP: AccessState = { _tag: 'setting-up' };

const RETRY_FLOOR = Duration.seconds(5);

const FIRST_RETRY_MS = 5_000;

const LAST_RETRY_MS = 300_000;

const unkept = (detail: string): Blocked => ({ _tag: 'blocked', problem: 'refused', detail, command: null, link: null });

export const makePlacements = Effect.gen(function* () {
  const exposure = yield* Exposure;
  const ledger = yield* Ledger;
  const sites = yield* WantedSites;
  const asks = yield* Queue.sliding<void>(1);
  const moves = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  const moved = PubSub.publish(moves, undefined);
  yield* moved;
  const change = (apply: () => void) => Effect.andThen(Effect.sync(apply), moved);
  const states = new Map<string, AccessState>();
  const hosts = new Map<string, string>();
  let wanted: ReadonlySet<string> = new Set();

  const blocked = () => [...wanted].some((name) => states.get(name)?._tag === 'blocked');

  const put = (name: string, state: AccessState) => {
    const before = states.get(name);
    if (before?._tag === 'ready') hosts.delete(new URL(before.origin).host);
    if (state._tag === 'ready') hosts.set(new URL(state.origin).host, name);
    states.set(name, state);
  };

  const keep: SiteKeeping = (name, port) =>
    Effect.mapError(ledger.keepSite(name, port), (failure) => unkept(`the port ${port} of ${name} could not be kept: ${failure.message}`));

  const place = Effect.fn('PlacedSites.place')(function* () {
    const names = wanted;
    for (const [name, state] of [...states]) if (!names.has(name) && state._tag !== 'ready') states.delete(name);
    const fresh = new Set([...names].filter((name) => states.get(name)?._tag !== 'ready'));
    if (fresh.size === 0) return;
    for (const name of fresh) states.set(name, SETTING_UP);
    yield* moved;
    yield* Effect.matchEffect(ledger.sites, {
      onFailure: (failure) =>
        change(() => {
          for (const name of fresh) states.set(name, unkept(`the ports of plugin sites could not be read: ${failure.message}`));
        }),
      onSuccess: (ports) => {
        const asked = [...fresh].map((name) => ({ name, port: ports.get(name) ?? null }));
        const reserved = [...ports].flatMap(([name, port]) => (fresh.has(name) ? [] : [port]));
        return Stream.runForEach(exposure.place(asked, reserved, keep), (placed) =>
          change(() => {
            if (wanted.has(placed.name)) put(placed.name, placed.state);
          }),
        );
      },
    });
  });

  const run = Effect.gen(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(sites.names, (names) =>
        Effect.sync(() => {
          wanted = names;
          Queue.offerUnsafe(asks, undefined);
        }),
      ),
    );
    const retry = yield* FiberHandle.make<void>();
    let pause = FIRST_RETRY_MS;
    return yield* Effect.forever(
      Effect.gen(function* () {
        yield* Queue.take(asks);
        yield* place();
        if (!blocked()) {
          pause = FIRST_RETRY_MS;
          return;
        }
        yield* FiberHandle.run(retry, Effect.andThen(Effect.sleep(Duration.millis(pause)), Queue.offer(asks, undefined)));
        pause = Math.min(pause * 2, LAST_RETRY_MS);
        yield* Effect.sleep(RETRY_FLOOR);
      }),
    );
  });

  return {
    state: (name: string) => states.get(name),
    at: (host: string) => hosts.get(host.toLowerCase()) ?? null,
    read: () => {
      if (blocked()) Queue.offerUnsafe(asks, undefined);
      return Object.fromEntries([...states].filter(([name]) => wanted.has(name)));
    },
    forget: change(() => {
      states.clear();
      hosts.clear();
    }),
    run,
    moved: Stream.fromPubSub(moves),
  };
});
