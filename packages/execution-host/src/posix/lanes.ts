/// <reference types="bun" />

import type { Server, ServerWebSocket } from 'bun';
import { Deferred, Effect, Exit, type Fiber, Schema } from 'effect';
import * as Base64Url from 'effect/encoding/Base64Url';
import { TRANSFER_LIMIT } from '@runlith/executions/protocol/capacity';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import {
  LANE_PATH,
  LaneClose,
  LaneHelloText,
  type LaneInput,
  type LaneReply,
  type LaneRequest,
  LaneRequestText,
  outputFrame,
  type TerminalLane,
} from '@runlith/executions/protocol/lane';
import { offsetValue } from '@runlith/executions/protocol/record';
import type { Binding } from '../Bindings';
import type { ExecutionInput } from '../ExecutionInput';

export type LaneUnserved = { readonly _tag: 'LaneUnserved'; readonly detail: string };

export type LaneHost = {
  readonly input: (handle: number) => ExecutionInput | undefined;
  readonly admitted: (handle: number, input: LaneInput) => void;
};

type Piece = { readonly at: bigint; readonly bytes: Uint8Array; length: number };

type Output = {
  readonly ref: ExecutionRef;
  head: bigint;
  held: number;
  ended: boolean;
  readonly pieces: Piece[];
  readonly viewers: Set<Connection>;
};

type Lane = { readonly token: string; readonly handle: number; binding: Binding; connection: Connection | undefined };

type Connection = {
  readonly socket: ServerWebSocket<Socketed>;
  readonly inbox: string[];
  wake: Deferred.Deferred<void> | undefined;
  lane: Lane | undefined;
  position: bigint | undefined;
  fiber: Fiber.Fiber<void> | undefined;
  closed: boolean;
};

type Socketed = { connection: Connection | undefined };

type Act = Extract<LaneRequest, { readonly t: 'act' }>;

const PIECE_BYTES = TRANSFER_LIMIT;

const reply = (said: typeof LaneReply.Encoded): string => JSON.stringify(said);

const ENDED = reply({ t: 'ended' });

const unserved = (detail: string): LaneUnserved => ({ _tag: 'LaneUnserved', detail });

export const makeLanes = Effect.fnUntraced(function* ({ tail, host }: { readonly tail: number; readonly host: LaneHost }) {
  const run = Effect.runForkWith(yield* Effect.context<never>());
  const outputs = new Map<number, Output>();
  const lanes = new Map<string, Lane>();
  let server: Server<Socketed> | undefined;

  const detach = (connection: Connection): void => {
    const lane = connection.lane;
    if (lane === undefined) return;
    if (lane.connection === connection) lane.connection = undefined;
    outputs.get(lane.handle)?.viewers.delete(connection);
  };

  const close = (connection: Connection, code: number, reason: string): void => {
    if (connection.closed) return;
    connection.closed = true;
    detach(connection);
    connection.socket.close(code, reason);
    connection.fiber?.interruptUnsafe();
  };

  const refuse = (connection: Connection, code: number, reason: string): Effect.Effect<never> =>
    Effect.andThen(
      Effect.sync(() => close(connection, code, reason)),
      Effect.interrupt,
    );

  const deliver = (connection: Connection, payload: string | Uint8Array): boolean => {
    if (connection.closed) return false;
    if (connection.socket.send(payload) !== 0) return true;
    close(connection, LaneClose.slow, 'this connection fell behind the live output of its terminal');
    return false;
  };

  const push = (connection: Connection, at: bigint, bytes: Uint8Array, frame?: Uint8Array): boolean => {
    const position = connection.position;
    if (position === undefined) return true;
    const end = at + BigInt(bytes.length);
    if (position >= end) return true;
    if (position < at) {
      close(connection, LaneClose.slow, 'the live output moved past this connection');
      return false;
    }
    connection.position = end;
    return deliver(
      connection,
      position === at && frame !== undefined ? frame : outputFrame(position, bytes.subarray(Number(position - at))),
    );
  };

  const watch = (connection: Connection, lane: Lane, from: bigint): void => {
    const output = outputs.get(lane.handle);
    if (output === undefined) return close(connection, LaneClose.closed, 'the terminal of this lane is gone');
    const start = output.pieces[0]?.at ?? output.head;
    if (from < start) {
      connection.position = undefined;
      output.viewers.delete(connection);
      deliver(connection, reply({ t: 'behind', retainedFrom: String(start) }));
      return;
    }
    connection.position = from;
    output.viewers.add(connection);
    for (const piece of output.pieces) if (!push(connection, piece.at, piece.bytes.subarray(0, piece.length))) return;
    if (output.ended) deliver(connection, ENDED);
  };

  const take = (connection: Connection): Effect.Effect<string> =>
    Effect.suspend(() => {
      const text = connection.inbox.shift();
      if (text !== undefined) return Effect.succeed(text);
      connection.wake ??= Deferred.makeUnsafe<void>();
      return Effect.andThen(Deferred.await(connection.wake), take(connection));
    });

  const act = Effect.fnUntraced(function* (connection: Connection, lane: Lane, request: Act) {
    const queue = host.input(lane.handle);
    if (queue === undefined) return yield* refuse(connection, LaneClose.closed, 'the input of this terminal is gone');
    const answer = yield* queue
      .admit(
        {
          sequence: request.sequence,
          cause: request.cause,
          act: request.act._tag === 'Write' ? { _tag: 'Write', bytes: request.act.bytes } : { _tag: 'Interrupt' },
        },
        lane.binding,
      )
      .pipe(Effect.catchTag('InputFenced', (fenced) => refuse(connection, LaneClose.closed, fenced.detail)));
    deliver(connection, reply({ t: 'receipt', sequence: request.sequence, answer }));
    if (answer._tag === 'InputAdmitted') {
      host.admitted(lane.handle, { binding: lane.binding.id, principal: lane.binding.principal, receipt: answer.receipt });
    }
  });

  const serve = Effect.fnUntraced(function* (connection: Connection) {
    const hello = yield* Schema.decodeUnknownEffect(LaneHelloText)(yield* take(connection)).pipe(
      Effect.catchTag('SchemaError', () => refuse(connection, LaneClose.malformed, 'the first frame of a lane names its secret')),
    );
    const lane = lanes.get(hello.lane);
    const output = lane === undefined ? undefined : outputs.get(lane.handle);
    if (lane === undefined || output === undefined) return yield* refuse(connection, LaneClose.unknown, 'no lane stands under this secret');
    if (lane.connection !== undefined) close(lane.connection, LaneClose.replaced, 'a newer connection took this lane');
    lane.connection = connection;
    connection.lane = lane;
    if (!deliver(connection, reply({ t: 'ready', execution: output.ref.execution, head: String(output.head) }))) return;
    for (;;) {
      const request = yield* Schema.decodeUnknownEffect(LaneRequestText)(yield* take(connection)).pipe(
        Effect.catchTag('SchemaError', () => refuse(connection, LaneClose.malformed, 'a frame this lane does not read')),
      );
      if (request.t === 'follow') watch(connection, lane, offsetValue(request.offset));
      else yield* act(connection, lane, request);
    }
  });

  const listen = Effect.suspend(() => {
    const standing = server?.port;
    if (standing !== undefined) return Effect.succeed(standing);
    return Effect.try({
      try: () => {
        const listening = Bun.serve<Socketed>({
          hostname: '127.0.0.1',
          port: 0,
          fetch: (request, at) => {
            if (new URL(request.url).pathname !== LANE_PATH) return new Response('no terminal lane is served here', { status: 404 });
            return at.upgrade(request, { data: { connection: undefined } })
              ? undefined
              : new Response('a terminal lane is a WebSocket', { status: 426 });
          },
          websocket: {
            backpressureLimit: tail,
            open: (socket) => {
              const connection: Connection = {
                socket,
                inbox: [],
                wake: undefined,
                lane: undefined,
                position: undefined,
                fiber: undefined,
                closed: false,
              };
              socket.data.connection = connection;
              connection.fiber = run(serve(connection));
            },
            message: (socket, message) => {
              const connection = socket.data.connection;
              if (connection === undefined || connection.closed) return;
              if (typeof message !== 'string') return close(connection, LaneClose.malformed, 'a lane reads text frames only');
              connection.inbox.push(message);
              const wake = connection.wake;
              connection.wake = undefined;
              if (wake !== undefined) Deferred.doneUnsafe(wake, Exit.void);
            },
            close: (socket) => {
              const connection = socket.data.connection;
              if (connection === undefined || connection.closed) return;
              connection.closed = true;
              detach(connection);
              connection.fiber?.interruptUnsafe();
            },
          },
        });
        server = listening;
        const port = listening.port;
        if (port === undefined) throw new Error('the server answered no port');
        return port;
      },
      catch: (error) => unserved(`the terminal endpoint could not listen on loopback: ${String(error)}`),
    });
  });

  const end = (handle: number, which: (binding: Binding) => boolean = () => true): void => {
    for (const [token, lane] of lanes) {
      if (lane.handle !== handle || !which(lane.binding)) continue;
      lanes.delete(token);
      if (lane.connection !== undefined) close(lane.connection, LaneClose.closed, 'this lane was closed');
    }
  };

  return {
    feed: (handle: number, ref: ExecutionRef, base: bigint): void => {
      outputs.set(handle, { ref, head: base, held: 0, ended: false, pieces: [], viewers: new Set() });
    },

    pumped: (handle: number, chunk: Uint8Array): void => {
      const output = outputs.get(handle);
      if (output === undefined || chunk.length === 0) return;
      const at = output.head;
      output.head = at + BigInt(chunk.length);
      output.held += chunk.length;
      const last = output.pieces.at(-1);
      if (last !== undefined && last.length + chunk.length <= last.bytes.length) {
        last.bytes.set(chunk, last.length);
        last.length += chunk.length;
      } else if (chunk.length >= PIECE_BYTES) output.pieces.push({ at, bytes: chunk, length: chunk.length });
      else {
        const bytes = new Uint8Array(PIECE_BYTES);
        bytes.set(chunk);
        output.pieces.push({ at, bytes, length: chunk.length });
      }
      while (output.pieces.length > 1 && output.held - output.pieces[0]!.length >= tail) output.held -= output.pieces.shift()!.length;
      if (output.viewers.size === 0) return;
      const frame = outputFrame(at, chunk);
      for (const viewer of output.viewers) push(viewer, at, chunk, frame);
    },

    ended: (handle: number): void => {
      const output = outputs.get(handle);
      if (output === undefined || output.ended) return;
      output.ended = true;
      for (const viewer of output.viewers) deliver(viewer, ENDED);
    },

    open: Effect.fnUntraced(function* (handle: number, binding: Binding) {
      const queue = host.input(handle);
      if (queue === undefined || !outputs.has(handle)) {
        return yield* Effect.fail(
          unserved(`terminal ${handle} serves no live output; its reading began before its record named an offset`),
        );
      }
      const port = yield* listen;
      let lane = [...lanes.values()].find((standing) => standing.handle === handle && standing.binding.id === binding.id);
      if (lane === undefined) {
        lane = { token: Base64Url.encode(crypto.getRandomValues(new Uint8Array(32))), handle, binding, connection: undefined };
        lanes.set(lane.token, lane);
      } else lane.binding = binding;
      return { port, token: lane.token, next: yield* queue.next(binding) } satisfies TerminalLane;
    }),

    end: (handle: number, binding?: BindingId, principal?: Principal): void =>
      end(handle, (held) => (binding === undefined || held.id === binding) && (principal === undefined || held.principal === principal)),

    forget: (handle: number): void => {
      end(handle);
      outputs.delete(handle);
    },
  };
});

export type Lanes = Effect.Success<ReturnType<typeof makeLanes>>;
