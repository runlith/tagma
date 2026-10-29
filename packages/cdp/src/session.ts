import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';
import { type Cause, Data, Deferred, Effect, Queue, type Scope, Stream } from 'effect';
import type { WorkerUnavailable } from '@runlith/utils/worker';
import { commandText, header } from './wire.js';
import { parsed, type PayloadUnreadable } from './payload.js';

export type Method = keyof ProtocolMapping.Commands;
export type Params<M extends Method> = ProtocolMapping.Commands[M]['paramsType'][0];
export type Result<M extends Method> = ProtocolMapping.Commands[M]['returnType'];
export type SendArgs<M extends Method> =
  undefined extends Params<M> ? [params?: Params<M>, child?: string] : [params: Params<M>, child?: string];
export type EventName = keyof ProtocolMapping.Events;
export type EventParams<E extends EventName> = ProtocolMapping.Events[E][0];

export type SessionEnd = 'detached' | 'taken' | 'lost' | 'closed';

export class CommandRefused extends Data.TaggedError('CommandRefused')<{
  readonly method: string;
  readonly code: number;
  readonly message: string;
}> {}

export class SessionEnded extends Data.TaggedError('SessionEnded')<{
  readonly message: string;
  readonly end: SessionEnd;
  readonly pending: boolean;
  readonly child?: string;
}> {}

export class TransportLost extends Data.TaggedError('TransportLost')<{ readonly message: string }> {}

export type CommandFailure = CommandRefused | SessionEnded | PayloadUnreadable | WorkerUnavailable;

const FAILURES: ReadonlySet<unknown> = new Set(['CommandRefused', 'SessionEnded', 'PayloadUnreadable', 'WorkerUnavailable']);

export const isCommandFailure = (failure: unknown): failure is CommandFailure =>
  typeof failure === 'object' && failure !== null && FAILURES.has((failure as { readonly _tag?: unknown })._tag);

export type CdpEvent = {
  readonly method: string;
  readonly child: string | undefined;
  readonly text: string;
};

export type Transport = {
  readonly send: (text: string) => Effect.Effect<void, TransportLost>;
  readonly incoming: Stream.Stream<string, TransportLost>;
};

export interface Session {
  send<M extends Method>(method: M, ...args: SendArgs<M>): Effect.Effect<Result<M>, CommandFailure>;
  reply<M extends Method>(method: M, ...args: SendArgs<M>): Effect.Effect<string, CommandRefused | SessionEnded>;
  post<M extends Method>(method: M, ...args: SendArgs<M>): Effect.Effect<void>;
  events(wanted?: (method: string) => boolean): Effect.Effect<Stream.Stream<CdpEvent>, never, Scope.Scope>;
  readonly ended: Effect.Effect<SessionEnd>;
}

export interface Connection {
  readonly root: Session;
  attach(sessionId: string): Effect.Effect<Session, never, Scope.Scope>;
  end(reason: SessionEnd): Effect.Effect<void>;
  readonly ended: Effect.Effect<SessionEnd>;
}

type Listener = { readonly wanted: (method: string) => boolean; readonly queue: Queue.Queue<CdpEvent, Cause.Done> };

type Owner = {
  readonly id: string | undefined;
  readonly listeners: Set<Listener>;
  readonly ended: Deferred.Deferred<SessionEnd>;
  readonly children: Set<string>;
  readonly pending: Set<number>;
  end: SessionEnd | null;
};

type Waiting = {
  readonly answered: Deferred.Deferred<string, CommandRefused | SessionEnded>;
  readonly owner: Owner;
  readonly method: string;
  readonly to: string | undefined;
};

const EVENT_TRIM = 64 * 1024;

const every = (): boolean => true;

export const eventParams = <E extends EventName>(
  _name: E,
  event: CdpEvent,
): Effect.Effect<EventParams<E>, PayloadUnreadable | WorkerUnavailable> =>
  Effect.map(parsed(event.text, EVENT_TRIM), (message) => (message as { readonly params: EventParams<E> }).params);

const resultOf = <M extends Method>(text: string): Effect.Effect<Result<M>, PayloadUnreadable | WorkerUnavailable> =>
  Effect.map(parsed(text), (message) => (message as { readonly result: Result<M> }).result);

const refusalOf = (method: string, text: string): CommandRefused => {
  try {
    const { error } = JSON.parse(text) as { readonly error?: { readonly code?: number; readonly message?: string } };
    return new CommandRefused({ method, code: error?.code ?? 0, message: error?.message ?? 'the browser refused without a reason' });
  } catch {
    return new CommandRefused({ method, code: 0, message: 'the browser refused with an unreadable reply' });
  }
};

export const connect = Effect.fnUntraced(function* (transport: Transport) {
  const owners = new Map<string, Owner>();
  const waiting = new Map<number, Waiting>();
  const lost = yield* Deferred.make<SessionEnd>();
  let next = 0;

  const makeOwner = Effect.fnUntraced(function* (id: string | undefined) {
    const owner: Owner = {
      id,
      listeners: new Set(),
      ended: yield* Deferred.make<SessionEnd>(),
      children: new Set(),
      pending: new Set(),
      end: null,
    };
    if (id !== undefined) owners.get(id)?.children.delete(id);
    owners.set(id ?? '', owner);
    return owner;
  });

  const close = Effect.fnUntraced(function* (owner: Owner, end: SessionEnd, message = `the CDP session ended: ${end}`) {
    if (!(yield* Deferred.succeed(owner.ended, end))) return;
    owner.end = end;
    if (owners.get(owner.id ?? '') === owner) owners.delete(owner.id ?? '');
    for (const child of owner.children) owners.delete(child);
    const failure = new SessionEnded({ message, end, pending: true });
    for (const id of owner.pending) {
      const held = waiting.get(id);
      waiting.delete(id);
      if (held !== undefined) yield* Deferred.fail(held.answered, failure);
    }
    owner.pending.clear();
  });

  const targetSession = (text: string): string | undefined => {
    try {
      const message = JSON.parse(text) as { readonly params?: { readonly sessionId?: unknown } };
      return typeof message.params?.sessionId === 'string' ? message.params.sessionId : undefined;
    } catch {
      return undefined;
    }
  };

  const arrive = Effect.fnUntraced(function* (text: string) {
    const head = header(text);
    if (head.id !== undefined) {
      const held = waiting.get(head.id);
      if (held === undefined) return;
      waiting.delete(head.id);
      held.owner.pending.delete(head.id);
      if (head.error) yield* Deferred.fail(held.answered, refusalOf(held.method, text));
      else yield* Deferred.succeed(held.answered, text);
      return;
    }
    const method = head.method;
    if (method === undefined) return;
    const owner = owners.get(head.sessionId ?? '');
    if (method === 'Target.attachedToTarget' && owner !== undefined) {
      const child = targetSession(text);
      if (child !== undefined && !owners.has(child)) {
        owner.children.add(child);
        owners.set(child, owner);
      }
    } else if (method === 'Target.detachedFromTarget') {
      const gone = targetSession(text);
      const held = gone === undefined ? undefined : owners.get(gone);
      if (gone !== undefined && held !== undefined) {
        if (held.id === gone) yield* close(held, 'detached');
        else {
          held.children.delete(gone);
          owners.delete(gone);
          const failure = new SessionEnded({
            message: `the CDP session ${gone} ended: detached`,
            end: 'detached',
            pending: true,
            child: gone,
          });
          for (const id of [...held.pending]) {
            const sent = waiting.get(id);
            if (sent?.to !== gone) continue;
            waiting.delete(id);
            held.pending.delete(id);
            yield* Deferred.fail(sent.answered, failure);
          }
        }
      }
    }
    if (owner === undefined) return;
    const child = head.sessionId === owner.id ? undefined : head.sessionId;
    const event: CdpEvent = { method, child, text };
    for (const listener of owner.listeners) if (listener.wanted(method)) Queue.offerUnsafe(listener.queue, event);
  });

  const viewOf = (owner: Owner): Session => {
    const reply = <M extends Method>(method: M, ...args: SendArgs<M>): Effect.Effect<string, CommandRefused | SessionEnded> =>
      Effect.suspend(() => {
        const [params, child] = args as [object | undefined, string | undefined];
        if (owner.end !== null)
          return Effect.fail(new SessionEnded({ message: `the CDP session already ended: ${owner.end}`, end: owner.end, pending: false }));
        const id = ++next;
        const answered = Deferred.makeUnsafe<string, CommandRefused | SessionEnded>();
        waiting.set(id, { answered, owner, method, to: child ?? owner.id });
        owner.pending.add(id);
        const forget = Effect.sync(() => {
          waiting.delete(id);
          owner.pending.delete(id);
        });
        return transport.send(commandText(id, method, params, child ?? owner.id)).pipe(
          Effect.catchTag('TransportLost', (gone) => Effect.fail(new SessionEnded({ message: gone.message, end: 'lost', pending: false }))),
          Effect.andThen(Deferred.await(answered)),
          Effect.onInterrupt(() => forget),
        );
      });
    return {
      reply,
      post: <M extends Method>(method: M, ...args: SendArgs<M>) =>
        Effect.suspend(() => {
          if (owner.end !== null) return Effect.void;
          const [params, child] = args as [object | undefined, string | undefined];
          return transport
            .send(commandText(++next, method, params, child ?? owner.id))
            .pipe(Effect.catchTag('TransportLost', (gone) => Effect.logDebug(`cdp: ${method} was not posted: ${gone.message}`)));
        }),
      send: <M extends Method>(method: M, ...args: SendArgs<M>) => Effect.flatMap(reply(method, ...args), (text) => resultOf<M>(text)),
      events: (wanted = every) =>
        Effect.map(
          Effect.acquireRelease(
            Effect.map(Queue.unbounded<CdpEvent, Cause.Done>(), (queue) => {
              const listener: Listener = { wanted, queue };
              owner.listeners.add(listener);
              return listener;
            }),
            (listener) =>
              Effect.suspend(() => {
                owner.listeners.delete(listener);
                return Queue.end(listener.queue);
              }),
          ),
          ({ queue }) => Stream.fromQueue(queue).pipe(Stream.interruptWhen(Deferred.await(owner.ended))),
        ),
      ended: Deferred.await(owner.ended),
    };
  };

  const root = yield* makeOwner(undefined);

  const endAll = Effect.fnUntraced(function* (message: string) {
    yield* Deferred.succeed(lost, 'lost');
    for (const owner of new Set(owners.values())) yield* close(owner, 'lost', message);
    yield* close(root, 'lost', message);
  });

  yield* Stream.runForEach(transport.incoming, arrive).pipe(
    Effect.matchEffect({
      onFailure: (gone) => endAll(`the CDP transport broke: ${gone.message}`),
      onSuccess: () => endAll('the CDP transport ended'),
    }),
    Effect.onInterrupt(() => endAll('the CDP connection closed')),
    Effect.forkScoped,
  );

  return {
    root: viewOf(root),
    attach: (sessionId) => Effect.acquireRelease(makeOwner(sessionId), (owner) => close(owner, 'closed')).pipe(Effect.map(viewOf)),
    end: Effect.fnUntraced(function* (reason) {
      for (const owner of new Set(owners.values())) yield* close(owner, reason);
    }),
    ended: Deferred.await(lost),
  } satisfies Connection;
});
