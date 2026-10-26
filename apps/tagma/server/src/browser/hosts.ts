import { Effect, Layer, PubSub, Semaphore, Stream } from 'effect';
import { type Host, HostAway, Hosts, type HostWatch } from './contract/service/hosts.js';

const PID_LOOK = '1 second';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as { readonly code?: string }).code === 'EPERM';
  }
};

type Watching = { readonly watch: HostWatch; readonly lock: Semaphore.Semaphore; readonly told: Set<Host> };

export const makeHosts = Effect.gen(function* () {
  const standing = new Map<string, Host[]>();
  const departed = new Map<string, number>();
  const known = new Set<Host>();
  const watching = new Set<Watching>();
  const arrivals = yield* PubSub.unbounded<string>();

  const connected = (adapter: string): Host | undefined => standing.get(adapter)?.at(-1);

  const tell = (held: Watching, host: Host) =>
    held.lock.withPermits(1)(
      Effect.suspend(() => {
        if (held.told.has(host) || !known.has(host)) return Effect.void;
        held.told.add(host);
        return held.watch.attached(host);
      }),
    );

  const untell = (held: Watching, host: Host) =>
    held.lock.withPermits(1)(Effect.suspend(() => (held.told.delete(host) ? held.watch.detached(host) : Effect.void)));

  const arrive = Effect.fnUntraced(function* (host: Host) {
    known.add(host);
    for (const held of [...watching]) yield* tell(held, host);
    if (!known.has(host)) return;
    standing.set(host.adapter, [...(standing.get(host.adapter) ?? []), host]);
    departed.delete(host.adapter);
    yield* PubSub.publish(arrivals, host.adapter);
  });

  const leave = Effect.fnUntraced(function* (host: Host) {
    const attaching = known.has(host) && !(standing.get(host.adapter) ?? []).includes(host);
    known.delete(host);
    const rest = (standing.get(host.adapter) ?? []).filter((held) => held !== host);
    if (rest.length === 0) standing.delete(host.adapter);
    else standing.set(host.adapter, rest);
    if (rest.length === 0 && host.pid !== null && alive(host.pid)) departed.set(host.adapter, host.pid);
    for (const held of [...watching]) yield* untell(held, host);
    if (attaching) yield* PubSub.publish(arrivals, host.adapter);
  });

  const watch = (watch: HostWatch) =>
    Effect.acquireRelease(
      Effect.map(Semaphore.make(1), (lock) => {
        const held: Watching = { watch, lock, told: new Set() };
        watching.add(held);
        return held;
      }),
      (held) => Effect.sync(() => watching.delete(held)),
    ).pipe(Effect.flatMap((held) => Effect.forEach([...known], (host) => tell(held, host), { discard: true })));

  const away = (adapter: string) =>
    new HostAway({ adapter, message: `no host of the ${adapter} browser adapter is connected to this server` });

  const reach = Effect.fn('Hosts.reach')(function* (adapter: string) {
    const held = connected(adapter);
    if (held !== undefined) return held;
    const pid = departed.get(adapter);
    const attaching = [...known].some((host) => host.adapter === adapter);
    if (!attaching && (pid === undefined || !alive(pid))) return yield* away(adapter);
    const back = yield* PubSub.subscribe(arrivals).pipe(Effect.map(Stream.fromSubscription));
    const ready = connected(adapter);
    if (ready !== undefined) return ready;
    if (attaching && ![...known].some((host) => host.adapter === adapter)) return yield* away(adapter);
    const returned = Stream.runHead(
      Stream.filter(
        back,
        (arrived) => arrived === adapter && (connected(adapter) !== undefined || ![...known].some((host) => host.adapter === adapter)),
      ),
    );
    const died =
      attaching || pid === undefined
        ? Effect.never
        : Effect.gen(function* () {
            for (;;) {
              yield* Effect.sleep(PID_LOOK);
              if (connected(adapter) !== undefined) return;
              if (!alive(pid)) return yield* away(adapter);
            }
          });
    yield* Effect.raceFirst(returned, died);
    const now = connected(adapter);
    return now === undefined ? yield* away(adapter) : now;
  }, Effect.scoped);

  return Hosts.of({
    attach: (host) =>
      Effect.andThen(
        Effect.addFinalizer(() => leave(host)),
        arrive(host),
      ),
    reach,
    connected,
    adapters: () => new Set(standing.keys()),
    watch,
  });
});

export const hostsLayer = Layer.effect(Hosts, makeHosts);
