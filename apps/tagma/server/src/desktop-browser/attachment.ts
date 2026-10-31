import { KeyUnavailable } from '@runlith/browser-cookies/source';
import { bytesOf } from '@runlith/cdp/payload';
import { type Connection, connect, type SessionEnd, type Transport, TransportLost } from '@runlith/cdp/session';
import { type Cause, Deferred, Effect, PubSub, Queue, Schema, Stream } from 'effect';
import {
  DebuggerTaken,
  type Host,
  HostLost,
  HostRefused,
  NavigationBlocked,
  NavigationFailed,
  PageMissing,
  PageStayed,
} from '../browser/contract/service/hosts.js';
import type { HostEvent } from '../browser/contract/wire/host.js';
import type { WindowDeclaration } from '../executions/contract/wire/load.js';
import type { PageId } from '../browser/contract/wire/ids.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ANSWERS, type Call, DESKTOP, type Failure, type Order, Parts, Report, split } from './contract/wire/channel.js';

const HELD_LIMIT = 4096;

type Answered = { readonly value: unknown; readonly tail: string | undefined };

type Watched = {
  readonly signal: Deferred.Deferred<never, NavigationBlocked>;
  failure: NavigationBlocked | null;
};

type Linked = {
  readonly incoming: Queue.Queue<string, TransportLost | Cause.Done>;
  connection: Connection | null;
  end: SessionEnd | null;
};

export type Broken = GateRefusal<'channel-broken'>;

const broken = (reason: string): Broken => new GateRefusal('channel-broken', reason, ['the desktop connects again by itself']);

const isFailure = (failure: Failure | HostLost): failure is Failure => !(failure instanceof HostLost);

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Report));
const decodeParts = Schema.decodeUnknownEffect(Schema.fromJsonString(Parts));

export type Attachment = {
  readonly host: Host;
  readonly generation: number;
  readonly feed: Stream.Stream<Order, Broken>;
  readonly take: (message: string) => Effect.Effect<void, Broken>;
  readonly end: (reason: string) => Effect.Effect<void>;
  readonly ended: Effect.Effect<void>;
  readonly done: () => boolean;
  readonly key: (service: string, account: string) => Effect.Effect<string, KeyUnavailable>;
};

export const makeAttachment = Effect.fnUntraced(function* (input: {
  readonly id: string;
  readonly generation: number;
  readonly pid: number;
  readonly declare: (declaration: WindowDeclaration) => Effect.Effect<void>;
}) {
  const { id, generation } = input;
  const orders = yield* Queue.unbounded<Order, Broken | Cause.Done>();
  const events = yield* PubSub.unbounded<HostEvent>();
  const finished = yield* Deferred.make<void>();
  const calls = new Map<number, Deferred.Deferred<Answered, Failure | HostLost>>();
  const sent = new Set<number>();
  const sessions = new Map<number, Linked>();
  const watches = new Map<number, Watched>();
  const held = new Map<number, { readonly report: Report; readonly tail: string | undefined }>();
  let parts: { readonly count: number; readonly texts: string[] } | null = null;
  let expected = 1;
  let lastCall = 0;
  let lastSession = 0;
  let lastWatch = 0;
  let lastHold = 0;

  const done = () => Deferred.isDoneUnsafe(finished);

  const gone = (pending: boolean, what: string) =>
    new HostLost({
      message: pending
        ? `the desktop host ${id} left before answering ${what}; whether it took effect is unknown, and it was not repeated`
        : `the desktop host ${id} is no longer connected; ${what} was not sent`,
      pending,
    });

  const post = (call: Call) => (done() ? Effect.void : Effect.asVoid(Queue.offer(orders, { kind: 'call', id: ++lastCall, call })));

  const ask = (call: Call): Effect.Effect<Answered, Failure | HostLost> =>
    Effect.suspend(() => {
      if (done()) return Effect.fail(gone(false, call.kind));
      const at = ++lastCall;
      const answered = Deferred.makeUnsafe<Answered, Failure | HostLost>();
      calls.set(at, answered);
      return Queue.offer(orders, { kind: 'call', id: at, call }).pipe(
        Effect.andThen(Deferred.await(answered)),
        Effect.ensuring(
          Effect.sync(() => {
            calls.delete(at);
            sent.delete(at);
          }),
        ),
      );
    });

  const refusedOf = (failure: Failure): HostRefused | HostLost =>
    failure.kind === 'refused'
      ? new HostRefused({ message: failure.message, unblock: failure.unblock })
      : new HostLost({ message: `the desktop host answered ${failure.kind}: ${failure.message}`, pending: true });

  const plain = (call: Call) =>
    ask(call).pipe(
      Effect.asVoid,
      Effect.catchIf(isFailure, (failure) => Effect.fail(refusedOf(failure))),
    );

  const pageFailure = (page: PageId, failure: Failure): HostRefused | HostLost | PageMissing | DebuggerTaken | NavigationFailed => {
    switch (failure.kind) {
      case 'missing':
        return new PageMissing({ page, message: failure.message });
      case 'taken':
        return new DebuggerTaken({ page, message: failure.message });
      case 'navigation':
        return new NavigationFailed({ code: failure.code, message: failure.message });
      case 'blocked':
      case 'refused':
      case 'stayed':
        return refusedOf(failure);
    }
  };

  const onPage = (page: PageId, call: Call) =>
    ask(call).pipe(Effect.catchIf(isFailure, (failure) => Effect.fail(pageFailure(page, failure))));

  const holdPage = Effect.fnUntraced(function* (page: PageId, acquire: (hold: number) => Call, release: (hold: number) => Call) {
    const hold = ++lastHold;
    yield* Effect.addFinalizer(() => post(release(hold)));
    yield* onPage(page, acquire(hold)).pipe(
      Effect.asVoid,
      Effect.catchTags({
        DebuggerTaken: (taken) => Effect.fail(new HostLost({ message: taken.message, pending: true })),
        NavigationFailed: (failed) => Effect.fail(new HostLost({ message: failed.message, pending: true })),
      }),
    );
  });

  const unread = (what: string) => (failure: { readonly message: string }) =>
    new HostLost({ message: `the desktop host answered ${what} unreadably: ${failure.message}`, pending: true });

  const linked = Effect.fnUntraced(function* <E>(call: (session: number) => Call, refused: (failure: Failure) => E) {
    const session = ++lastSession;
    const incoming = yield* Queue.unbounded<string, TransportLost | Cause.Done>();
    const link: Linked = { incoming, connection: null, end: null };
    sessions.set(session, link);
    yield* Effect.addFinalizer(() =>
      Effect.andThen(
        Effect.sync(() => sessions.delete(session)),
        Effect.andThen(Queue.end(incoming), post({ kind: 'unsession', session })),
      ),
    );
    yield* ask(call(session)).pipe(Effect.catchIf(isFailure, (failure) => Effect.fail(refused(failure))));
    const transport: Transport = {
      send: (text) =>
        done()
          ? Effect.fail(new TransportLost({ message: `the desktop host ${id} is no longer connected` }))
          : Effect.asVoid(Queue.offer(orders, { kind: 'cdp', session, text })),
      incoming: Stream.fromQueue(incoming),
    };
    const connection = yield* connect(transport);
    link.connection = connection;
    if (link.end !== null) yield* connection.end(link.end);
    return connection.root;
  });

  const apply = Effect.fnUntraced(function* (report: Report, tail: string | undefined): Effect.fn.Return<void, Broken> {
    switch (report.kind) {
      case 'answer':
      case 'bytes': {
        const answered = calls.get(report.id);
        if (answered !== undefined) yield* Deferred.succeed(answered, { value: report.kind === 'answer' ? report.value : null, tail });
        return;
      }
      case 'failure': {
        const answered = calls.get(report.id);
        if (answered !== undefined) yield* Deferred.fail(answered, report.failure);
        return;
      }
      case 'event':
        yield* PubSub.publish(events, report.event);
        return;
      case 'blocked': {
        const watched = watches.get(report.watch);
        if (watched === undefined || watched.failure !== null) return;
        watched.failure = new NavigationBlocked({
          ...report.block,
          message: `navigation to ${report.block.domain} is blocked by ${report.block.setting}`,
        });
        yield* Deferred.fail(watched.signal, watched.failure);
        return;
      }
      case 'cdp': {
        if (tail === undefined) return yield* broken(`report ${report.seq} carries no CDP text`);
        const link = sessions.get(report.session);
        if (link !== undefined) yield* Queue.offer(link.incoming, tail);
        return;
      }
      case 'ended': {
        const link = sessions.get(report.session);
        if (link === undefined) return;
        link.end = report.end;
        if (link.connection !== null) yield* link.connection.end(report.end);
        yield* Queue.end(link.incoming);
        return;
      }
      case 'declaration':
        if (!done()) yield* input.declare(report.declaration);
        return;
    }
  });

  const arrive = Effect.fnUntraced(function* (text: string): Effect.fn.Return<void, Broken> {
    const { head, tail } = split(text);
    const report = yield* decodeReport(head).pipe(Effect.mapError((failure) => broken(`a report is unreadable: ${failure.message}`)));
    if (report.seq < expected) return yield* broken(`report ${report.seq} arrived again after ${expected - 1}`);
    if (report.seq > expected) {
      held.set(report.seq, { report, tail });
      if (held.size > HELD_LIMIT) return yield* broken(`report ${expected} never arrived while ${held.size} later ones waited for it`);
      return;
    }
    yield* apply(report, tail);
    expected += 1;
    for (let next = held.get(expected); next !== undefined; next = held.get(expected)) {
      held.delete(expected);
      yield* apply(next.report, next.tail);
      expected += 1;
    }
  });

  const take = (message: string): Effect.Effect<void, Broken> =>
    Effect.suspend(() => {
      if (parts !== null) {
        const gathering = parts;
        gathering.texts.push(message);
        if (gathering.texts.length < gathering.count) return Effect.void;
        parts = null;
        return arrive(gathering.texts.join(''));
      }
      if (!message.startsWith('{"parts":')) return arrive(message);
      return Effect.flatMap(
        decodeParts(message).pipe(Effect.mapError((failure) => broken(`a parted report is unreadable: ${failure.message}`))),
        ({ parts: count }) =>
          Effect.sync(() => {
            parts = { count, texts: [] };
          }),
      );
    });

  const end = Effect.fnUntraced(function* (reason: string) {
    if (!(yield* Deferred.succeed(finished, undefined))) return;
    for (const [at, answered] of calls) yield* Deferred.fail(answered, gone(sent.has(at), 'a call'));
    calls.clear();
    sent.clear();
    for (const link of sessions.values())
      yield* Queue.fail(link.incoming, new TransportLost({ message: `the desktop host ${id} left: ${reason}` }));
    yield* Queue.fail(orders, broken(reason));
    if (held.size > 0)
      yield* Effect.logWarning(`desktop browser: host ${id} left with report ${expected} missing before ${held.size} others`);
  });

  const host: Host = {
    id,
    adapter: DESKTOP,
    pid: input.pid,
    native: true,
    pages: {
      open: Effect.fn('DesktopHost.open')(function* (opening) {
        const { value } = yield* ask({
          kind: 'open',
          page: opening.page,
          profile: opening.profile.id,
          context: opening.context,
          url: opening.url,
          history: opening.history,
          policy: opening.policy,
        }).pipe(
          Effect.catchIf(isFailure, (failure) =>
            Effect.fail(
              failure.kind === 'blocked' ? new NavigationBlocked({ ...failure.block, message: failure.message }) : refusedOf(failure),
            ),
          ),
        );
        return yield* Schema.decodeUnknownEffect(ANSWERS.open)(value).pipe(Effect.mapError(unread('its opened page')));
      }),
      adopt: Effect.fn('DesktopHost.adopt')(function* (local, page) {
        const { value } = yield* onPage(page, { kind: 'adopt', local, page }).pipe(
          Effect.catchTags({
            DebuggerTaken: (taken) => Effect.fail(new HostLost({ message: taken.message, pending: true })),
            NavigationFailed: (failed) => Effect.fail(new HostLost({ message: failed.message, pending: true })),
          }),
        );
        return yield* Schema.decodeUnknownEffect(ANSWERS.adopt)(value).pipe(Effect.mapError(unread('its adopted page')));
      }),
      close: Effect.fn('DesktopHost.close')(function* (page, asking) {
        yield* ask({ kind: 'close', page, ask: asking }).pipe(
          Effect.catchIf(isFailure, (failure) =>
            Effect.fail(failure.kind === 'stayed' ? new PageStayed({ page, message: failure.message }) : refusedOf(failure)),
          ),
        );
      }),
      live: Effect.flatMap(
        Effect.catchIf(ask({ kind: 'live' }), isFailure, (failure) => Effect.fail(refusedOf(failure))),
        ({ value }) => Schema.decodeUnknownEffect(ANSWERS.live)(value).pipe(Effect.mapError(unread('its live pages'))),
      ).pipe(Effect.withSpan('DesktopHost.live')),
      navigate: Effect.fn('DesktopHost.navigate')(function* (page, to) {
        const { value } = yield* ask({ kind: 'navigate', page, to }).pipe(
          Effect.catchIf(isFailure, (failure) =>
            Effect.fail(
              failure.kind === 'blocked'
                ? new NavigationBlocked({ ...failure.block, message: failure.message })
                : pageFailure(page, failure),
            ),
          ),
          Effect.catchTag('DebuggerTaken', (taken) => Effect.fail(new HostLost({ message: taken.message, pending: true }))),
        );
        return yield* Schema.decodeUnknownEffect(ANSWERS.navigate)(value).pipe(Effect.mapError(unread('a navigation')));
      }),
      navigation: Effect.fn('DesktopHost.navigation')(function* (page, policy) {
        const watch = ++lastWatch;
        const watched: Watched = { signal: yield* Deferred.make<never, NavigationBlocked>(), failure: null };
        watches.set(watch, watched);
        yield* Effect.addFinalizer(() => {
          watches.delete(watch);
          return post({ kind: 'unnavigation', watch });
        });
        const { value } = yield* onPage(page, { kind: 'navigation', page, watch, policy }).pipe(
          Effect.catchTags({
            DebuggerTaken: (taken) => Effect.fail(new HostLost({ message: taken.message, pending: true })),
            NavigationFailed: (failed) => Effect.fail(new HostLost({ message: failed.message, pending: true })),
          }),
        );
        const { blocked: pending, changes } = yield* Schema.decodeUnknownEffect(ANSWERS.navigation)(value).pipe(
          Effect.mapError(unread('a navigation gate')),
        );
        if (pending !== null && watched.failure === null) {
          watched.failure = new NavigationBlocked({
            ...pending,
            message: `navigation to ${pending.domain} is blocked by ${pending.setting}`,
          });
          yield* Deferred.fail(watched.signal, watched.failure);
        }
        const seen = Effect.suspend(() => post({ kind: 'navigationSeen', watch }));
        return {
          changes,
          blocked: Deferred.await(watched.signal).pipe(Effect.tapError(() => seen)),
          check: Effect.suspend(() => (watched.failure === null ? Effect.void : Effect.fail(watched.failure))).pipe(
            Effect.tapError(() => seen),
          ),
        };
      }),
      pdf: Effect.fn('DesktopHost.pdf')(function* (page) {
        const { tail } = yield* onPage(page, { kind: 'pdf', page }).pipe(
          Effect.catchTags({
            DebuggerTaken: (taken) => Effect.fail(new HostLost({ message: taken.message, pending: true })),
            NavigationFailed: (failed) => Effect.fail(new HostLost({ message: failed.message, pending: true })),
          }),
        );
        if (tail === undefined) return yield* new HostLost({ message: 'the desktop host answered a PDF without its bytes', pending: true });
        return yield* bytesOf(tail).pipe(Effect.mapError(unread('a PDF')));
      }),
      heap: Effect.fn('DesktopHost.heap')(function* (page, path) {
        yield* onPage(page, { kind: 'heap', page, path }).pipe(
          Effect.asVoid,
          Effect.catchTags({
            DebuggerTaken: (taken) => Effect.fail(new HostLost({ message: taken.message, pending: true })),
            NavigationFailed: (failed) => Effect.fail(new HostLost({ message: failed.message, pending: true })),
          }),
        );
      }),
      answer: Effect.fn('DesktopHost.answer')(function* (page, accept, text) {
        yield* onPage(page, { kind: 'answer', page, accept, text: text ?? null }).pipe(
          Effect.asVoid,
          Effect.catchTags({
            DebuggerTaken: (taken) => Effect.fail(new HostLost({ message: taken.message, pending: true })),
            NavigationFailed: (failed) => Effect.fail(new HostLost({ message: failed.message, pending: true })),
          }),
        );
      }),
      events: Effect.map(PubSub.subscribe(events), (subscription) => Stream.fromSubscription(subscription)),
      paint: Effect.fn('DesktopHost.paint')(function* (page) {
        yield* holdPage(
          page,
          (hold) => ({ kind: 'paint', page, hold }),
          (hold) => ({ kind: 'unpaint', hold }),
        );
      }),
      strain: Effect.fn('DesktopHost.strain')(function* (page, strain) {
        yield* holdPage(
          page,
          (hold) => ({ kind: 'strain', page, hold, strain }),
          (hold) => ({ kind: 'unstrain', hold }),
        );
      }),
      geolocation: Effect.fn('DesktopHost.geolocation')(function* (page) {
        yield* holdPage(
          page,
          (hold) => ({ kind: 'geolocation', page, hold }),
          (hold) => ({ kind: 'unlocate', hold }),
        );
      }),
      session: Effect.fn('DesktopHost.session')(function* (page) {
        return yield* linked(
          (session) => ({ kind: 'session', page, session }),
          (failure) =>
            failure.kind === 'missing'
              ? new PageMissing({ page, message: failure.message })
              : failure.kind === 'taken'
                ? new DebuggerTaken({ page, message: failure.message })
                : refusedOf(failure),
        );
      }),
    },
    profiles: {
      prepare: Effect.fn('DesktopHost.prepare')(function* (profile) {
        yield* plain({ kind: 'prepare', profile: profile.id });
      }),
      session: Effect.fn('DesktopHost.profileSession')(function* (profile) {
        return yield* linked((session) => ({ kind: 'profileSession', profile: profile.id, session }), refusedOf);
      }),
      remove: Effect.fn('DesktopHost.remove')(function* (profile) {
        yield* plain({ kind: 'remove', profile });
      }),
    },
    capture: null,
  };

  const feed = Stream.fromQueue(orders).pipe(
    Stream.tap((order) =>
      Effect.sync(() => {
        if (order.kind === 'call' && calls.has(order.id)) sent.add(order.id);
      }),
    ),
  );

  const key = Effect.fn('DesktopHost.key')(function* (service: string, account: string) {
    const { value } = yield* ask({ kind: 'key', service, account }).pipe(
      Effect.mapError((failure) =>
        failure instanceof HostLost
          ? new KeyUnavailable({
              reason: 'away',
              message: `the Tagma app left before reading the Keychain key ${service}: ${failure.message}`,
            })
          : new KeyUnavailable({
              reason: failure.kind === 'missing' ? 'missing' : failure.kind === 'refused' ? 'denied' : 'failed',
              message: failure.message,
            }),
      ),
    );
    return yield* Schema.decodeUnknownEffect(ANSWERS.key)(value).pipe(
      Effect.mapError(
        (failure) =>
          new KeyUnavailable({ reason: 'failed', message: `the Tagma app answered the Keychain key unreadably: ${failure.message}` }),
      ),
    );
  });

  return {
    host,
    generation,
    feed,
    take,
    end,
    ended: Deferred.await(finished),
    done,
    key,
  } satisfies Attachment;
});
