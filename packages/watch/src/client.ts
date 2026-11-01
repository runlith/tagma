import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Data, Effect, Option, Schema, type Scope } from 'effect';
import { lockExclusive, unlock } from '@runlith/file-lock/flock';
import { buildEngine, crateStands } from './artifact.js';
import { LIBRARY } from './engine.js';
import { HELLO_MS, type Outbox, READY, decodeSaid, lines, outbox, type WatchAsk, type WatchChange, type WatchSaid } from './protocol.js';

const WATCHER = fileURLToPath(new URL('./watcher.ts', import.meta.url));

const SOCKET_PATH_MAX = 103;

const BUILD = /^[0-9a-f]+\.sock$/u;

const RETAIN_FLOOR = 1024;

const RETAIN_CEILING = 65_536;

const ANSWER_MS: { readonly [K in WatchAsk['t']]: number } = {
  subscribe: 120_000,
  unsubscribe: 30_000,
  snapshot: 120_000,
  since: 30_000,
  cursor: 10_000,
  settle: 10_000,
  moved: 10_000,
  retire: 10_000,
  shutdown: 10_000,
  hello: HELLO_MS,
};

export class WatchRefused extends Data.TaggedError('WatchRefused')<{ readonly message: string }> {}

export class WatchLost extends Data.TaggedError('WatchLost')<{ readonly message: string }> {}

export type WatchHearing = {
  readonly heard: (changes: readonly WatchChange[]) => void;
  readonly dropped: (reason: string, subtree: string | null) => void;
  readonly ended: (reason: string) => void;
};

export type WatchOptions = { readonly recursive: boolean; readonly ignore: readonly string[] };

export type WatchSubscription = { readonly close: Effect.Effect<void>; readonly leave: Effect.Effect<void> };

export type WatchLifetime = 'detached' | 'with-parent' | 'with-client';

export type WatchPlace = {
  readonly dir: string;
  readonly lifetime: WatchLifetime;
  readonly retain?: number;
};

export type Marking = 'refresh' | 'close';

export type WatchClient = {
  readonly subscribe: (
    at: string,
    options: WatchOptions,
    hearing: WatchHearing,
  ) => Effect.Effect<WatchSubscription, WatchRefused | WatchLost>;
  readonly mark: (
    at: string,
    file: string | null,
    ignore: readonly string[],
    lasting: boolean,
  ) => Effect.Effect<string, WatchRefused | WatchLost>;
  readonly settle: (at: string, ignore: readonly string[]) => Effect.Effect<boolean, WatchRefused | WatchLost>;
  readonly changedSince: (
    at: string,
    position: string,
    ignore: readonly string[],
  ) => Effect.Effect<readonly WatchChange[] | null, WatchRefused | WatchLost>;
  readonly marking: Marking;
  readonly shutdown: Effect.Effect<void>;
};

export const HEARD_LATE_MS = 100;

export const retainedPaths = (memory: number = totalmem()): number =>
  Math.max(RETAIN_FLOOR, Math.min(RETAIN_CEILING, Math.floor(memory / 2 ** 20)));

const buildOf = (): string => {
  if (crateStands()) buildEngine();
  const hash = createHash('sha256').update(readFileSync(WATCHER));
  for (const beside of ['protocol.ts', 'engine.ts']) {
    const path = join(dirname(WATCHER), beside);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  hash.update(readFileSync(LIBRARY));
  return hash.digest('hex').slice(0, 16);
};

type Channel = { readonly socket: string; readonly family: string };

const channelAt = (dir: string, build: string): Channel => {
  const beside = join(dir, `watch-${build}.sock`);
  if (Buffer.byteLength(beside) <= SOCKET_PATH_MAX) return { socket: beside, family: 'watch-' };
  const family = `runlith-watch-${createHash('sha256').update(dir).digest('hex').slice(0, 12)}-`;
  return { socket: join(tmpdir(), `${family}${build}.sock`), family };
};

export const channelIn = (dir: string, build: string = buildOf()): string => channelAt(dir, build).socket;

const Position = Schema.Struct({
  cursor: Schema.NullOr(Schema.String),
  snapshot: Schema.NullOr(Schema.String),
});
type Position = typeof Position.Type;
const decodePosition = Schema.decodeUnknownOption(Schema.fromJsonString(Position));

type Waiting = { readonly answer: (said: WatchSaid) => void; readonly lost: (reason: string) => void };

type Link = {
  readonly peer: Bun.Socket<undefined>;
  readonly waiting: Map<number, Waiting>;
  readonly hearings: Map<number, WatchHearing>;
  readonly out: Outbox;
  gone: string | null;
  pid: number | null;
};

type Asked = { readonly [K in WatchAsk['t']]: Omit<Extract<WatchAsk, { t: K }>, 'id'> }[WatchAsk['t']];

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const reaching = async (socket: string): Promise<Bun.Socket<undefined> | null> => {
  try {
    return await Bun.connect({ unix: socket, socket: { data: () => undefined } });
  } catch {
    return null;
  }
};

const retireOthers = async ({ socket: own, family }: Channel): Promise<void> => {
  const dir = dirname(own);
  const ofFamily = (name: string) => name.startsWith(family) && BUILD.test(name.slice(family.length));
  for (const name of readdirSync(dir).filter((one) => ofFamily(one) && join(dir, one) !== own)) {
    const socket = join(dir, name);
    const peer = await reaching(socket);
    if (peer !== null) {
      peer.write(`${JSON.stringify({ t: 'retire', id: 0 } satisfies WatchAsk)}\n`);
      peer.end();
      continue;
    }
    const guard = openSync(`${socket}.lock`, 'a');
    try {
      if (lockExclusive(guard) !== 'locked') continue;
      try {
        if ((await reaching(socket)) === null) rmSync(socket, { force: true });
      } finally {
        unlock(guard);
      }
    } finally {
      closeSync(guard);
    }
  }
};

export const makeWatchClient = Effect.fnUntraced(function* (place: WatchPlace): Effect.fn.Return<WatchClient, never, Scope.Scope> {
  const channel = channelAt(place.dir, buildOf());
  const { socket } = channel;
  const retain = place.retain ?? retainedPaths();
  let link: Promise<Link> | null = null;
  let live: Link | null = null;
  let child: Bun.Subprocess<'pipe' | 'ignore', 'pipe', number | 'inherit'> | null = null;
  let next = 0;
  let closed = false;
  let others: Promise<void> | null = null;
  let condemned: number | null = null;

  const lose = (held: Link, reason: string): void => {
    if (held.gone !== null) return;
    held.gone = reason;
    if (live === held) {
      live = null;
      link = null;
    }
    const waiting = [...held.waiting.values()];
    const hearings = [...held.hearings.values()];
    held.waiting.clear();
    held.hearings.clear();
    for (const one of waiting) one.lost(reason);
    for (const hearing of hearings) hearing.ended(reason);
  };

  const told = (held: Link, said: WatchSaid): void => {
    if (said.t === 'heard' || said.t === 'dropped') {
      const hearing = held.hearings.get(said.id);
      if (hearing === undefined) return;
      if (said.t === 'heard') return hearing.heard(said.changes);
      return hearing.dropped(said.reason, said.subtree);
    }
    if (said.t === 'ended') {
      const hearing = held.hearings.get(said.id);
      held.hearings.delete(said.id);
      hearing?.ended(said.reason);
    }
    const waiting = held.waiting.get(said.id);
    held.waiting.delete(said.id);
    waiting?.answer(said);
  };

  const connected = (): Promise<Link> => {
    let held: Link | null = null;
    const read = lines((line) => {
      const said = decodeSaid(line);
      if (held === null) return;
      if (said._tag === 'Failure') return lose(held, `the watch process said what is no answer: ${line.slice(0, 200)}`);
      told(held, said.success);
    });
    return Bun.connect({
      unix: socket,
      socket: {
        data: (_peer, chunk) => read(chunk),
        drain: () => held?.out.flush(),
        close: () => {
          if (held !== null) lose(held, 'the watch process closed its channel');
        },
        error: (_peer, cause) => {
          if (held !== null) lose(held, `the watch channel failed: ${reasonOf(cause)}`);
        },
      },
    })
      .then((peer) => {
        held = { peer, waiting: new Map(), hearings: new Map(), out: outbox((bytes) => peer.write(bytes)), gone: null, pid: null };
        return greeted(held);
      })
      .then((greeting) => {
        live = greeting;
        others ??= retireOthers(channel).catch((cause: unknown) =>
          console.error(`[watch] other watch processes were not retired: ${reasonOf(cause)}`),
        );
        return greeting;
      });
  };

  const greeted = (held: Link): Promise<Link> =>
    new Promise((resolve, reject) => {
      asked(
        held,
        { t: 'hello' },
        {
          answer: (said) => {
            if (said.t === 'hello') {
              held.pid = said.pid;
              return resolve(held);
            }
            lose(held, `the watch process answered hello with ${said.t}`);
            held.peer.end();
            reject(new Error(`the watch process answered hello with ${said.t}`));
          },
          lost: (reason) => reject(new Error(reason)),
        },
      );
    });

  const started = async (replacing: number | null): Promise<void> => {
    const owned = place.lifetime === 'with-client';
    mkdirSync(dirname(socket), { recursive: true });
    const log = owned ? null : openSync(`${socket}.log`, 'a');
    const condemning = replacing === null ? [] : [String(replacing)];
    const spawned = Bun.spawn([process.execPath, 'run', WATCHER, socket, String(retain), place.lifetime, ...condemning], {
      stdin: owned ? 'pipe' : place.lifetime === 'with-parent' ? 'inherit' : 'ignore',
      stdout: 'pipe',
      stderr: log ?? 'inherit',
      detached: true,
    });
    if (log !== null) closeSync(log);
    if (owned) child = spawned;
    spawned.unref();
    let ready = false;
    const reader = spawned.stdout.getReader();
    const read = lines((line) => {
      if (line === READY) ready = true;
    });
    while (!ready) {
      const chunk = await reader.read();
      if (chunk.done) break;
      read(chunk.value);
    }
    reader.releaseLock();
    if (!ready) {
      const code = await spawned.exited;
      if (child === spawned) child = null;
      if (code !== 0) throw new Error(`the watch process exited with code ${code} before it listened`);
    }
  };

  const fresh = (): Promise<Link> => {
    const replacing = condemned;
    condemned = null;
    return started(replacing).then(connected);
  };

  const linked = (): Promise<Link> => {
    if (closed) return Promise.reject(new Error('the watch client is closed'));
    link ??= (condemned === null ? connected().catch(fresh) : fresh()).catch((cause: unknown) => {
      link = null;
      throw cause;
    });
    return link;
  };

  const wrote = (held: Link, ask: WatchAsk, waiting: Waiting): void => {
    held.waiting.set(ask.id, waiting);
    held.out.push(`${JSON.stringify(ask)}\n`);
  };

  const asked = (held: Link, ask: Asked, waiting: Waiting): number => {
    const id = ++next;
    const within = ANSWER_MS[ask.t];
    const deadline = setTimeout(() => {
      if (!held.waiting.has(id)) return;
      if (held.pid !== null) condemned = held.pid;
      lose(held, `the watch process did not answer ${ask.t} within ${within} ms`);
      held.peer.end();
    }, within);
    deadline.unref();
    wrote(
      held,
      { ...ask, id },
      {
        answer: (said) => {
          clearTimeout(deadline);
          waiting.answer(said);
        },
        lost: (reason) => {
          clearTimeout(deadline);
          waiting.lost(reason);
        },
      },
    );
    return id;
  };

  const request = (ask: Asked): Effect.Effect<WatchSaid, WatchLost> =>
    Effect.callback<WatchSaid, WatchLost>((resume) => {
      linked().then(
        (held) => {
          if (held.gone !== null) return resume(Effect.fail(new WatchLost({ message: held.gone })));
          asked(held, ask, {
            answer: (said) => resume(Effect.succeed(said)),
            lost: (reason) => resume(Effect.fail(new WatchLost({ message: reason }))),
          });
        },
        (cause: unknown) => resume(Effect.fail(new WatchLost({ message: `the watch process could not be reached: ${reasonOf(cause)}` }))),
      );
    });

  const unsubscribed = (held: Link, id: number): Effect.Effect<void> =>
    Effect.callback<void>((resume) => {
      held.hearings.delete(id);
      if (held.gone !== null) return resume(Effect.void);
      wrote(held, { t: 'unsubscribe', id }, { answer: () => resume(Effect.void), lost: () => resume(Effect.void) });
    });

  const refusal = (said: WatchSaid): WatchRefused =>
    new WatchRefused({ message: said.t === 'refused' ? said.reason : `the watch process answered ${said.t}` });

  const answered = <T extends WatchSaid['t'], A>(ask: Asked, wanted: T, take: (said: Extract<WatchSaid, { t: T }>) => A) =>
    Effect.flatMap(request(ask), (said) =>
      said.t === wanted ? Effect.succeed(take(said as Extract<WatchSaid, { t: T }>)) : Effect.fail(refusal(said)),
    );

  const subscribe = (at: string, options: WatchOptions, hearing: WatchHearing) =>
    Effect.callback<WatchSubscription, WatchRefused | WatchLost>((resume) => {
      let abandoned = false;
      linked().then(
        (held) => {
          if (held.gone !== null) return resume(Effect.fail(new WatchLost({ message: held.gone })));
          const id = asked(
            held,
            { t: 'subscribe' as const, at, recursive: options.recursive, ignore: options.ignore },
            {
              answer: (said) => {
                if (said.t !== 'subscribed') {
                  held.hearings.delete(id);
                  return resume(Effect.fail(refusal(said)));
                }
                if (abandoned) return void Effect.runFork(unsubscribed(held, id));
                resume(Effect.succeed({ close: unsubscribed(held, id), leave: Effect.sync(() => held.hearings.delete(id)) }));
              },
              lost: (reason) => resume(Effect.fail(new WatchLost({ message: reason }))),
            },
          );
          held.hearings.set(id, hearing);
        },
        (cause: unknown) => resume(Effect.fail(new WatchLost({ message: `the watch process could not be reached: ${reasonOf(cause)}` }))),
      );
      return Effect.sync(() => {
        abandoned = true;
      });
    });

  const marking: Marking = process.platform === 'darwin' ? 'refresh' : 'close';

  const mark = Effect.fnUntraced(function* (at: string, file: string | null, ignore: readonly string[], lasting: boolean) {
    const cursor = yield* answered({ t: 'cursor', at, ignore }, 'cursor', (said) => said.cursor);
    const snapshot = file !== null && (lasting || marking === 'refresh') ? file : null;
    if (snapshot !== null) yield* answered({ t: 'snapshot', at, snapshot, ignore }, 'written', () => undefined);
    const position: Position = { cursor, snapshot };
    return JSON.stringify(position);
  });

  const settle = (at: string, ignore: readonly string[]) => answered({ t: 'settle', at, ignore }, 'settled', (said) => said.settled);

  const changedSince = Effect.fnUntraced(function* (at: string, given: string, ignore: readonly string[]) {
    const position = Option.getOrNull(decodePosition(given));
    if (position === null) return null;
    if (position.cursor !== null) {
      const moved = yield* answered({ t: 'moved', at, cursor: position.cursor }, 'moved', (said) => said.changes);
      if (moved !== null) return moved;
    }
    if (position.snapshot === null || !existsSync(position.snapshot)) return null;
    return yield* answered({ t: 'since', at, snapshot: position.snapshot, ignore }, 'changed', (said) => said.changes);
  });

  const shutdown = Effect.callback<void>((resume) => {
    const held = live;
    if (held === null || held.gone !== null) return resume(Effect.void);
    asked(held, { t: 'shutdown' }, { answer: () => resume(Effect.void), lost: () => resume(Effect.void) });
  });

  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      closed = true;
      await link?.catch(() => null);
      await others;
      const held = live;
      if (held !== null) {
        lose(held, 'the watch client closed');
        held.peer.end();
      }
      const spawned = child;
      child = null;
      if (spawned === null || spawned.stdin === undefined || typeof spawned.stdin === 'number') return;
      await spawned.stdin.end();
      await spawned.exited;
    }),
  );

  return { subscribe, mark, settle, changedSince, marking, shutdown };
});
