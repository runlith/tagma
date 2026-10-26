import { Cause, Effect, Exit, Option, Stream } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import * as Socket from 'effect/socket/Socket';
import { CallDevice } from '../../invocation/contract/service/admission.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Connections } from '../../socket/connections.js';
import type { Listenings } from '../../speech/contract/service/listenings.js';
import { SENDING_PATH } from '../../speech/contract/wire/listening.js';

const POLICY_CLOSE = 1008;

const closing = (code: number, reason: string) => new Socket.CloseEvent(code, reason.slice(0, 120));

export const sendingRoute = (listenings: Listenings['Service'], connections: Connections | null) =>
  HttpRouter.add('GET', SENDING_PATH, (request) =>
    Effect.gen(function* () {
      const asked = new URL(request.url, 'http://localhost').searchParams;
      const id = asked.get('id');
      if (id === null || id === '') return HttpServerResponse.text('name the recognition: ?id=<id>&track=<track>', { status: 400 });
      const socket = yield* Effect.orDie(request.upgrade);
      const { write } = yield* socket.writer;
      const pull = yield* Socket.readerBytes(socket);
      const device = yield* CallDevice;
      if (connections !== null && device !== null) {
        const leave = yield* connections.add(device, (code, reason) => write(new Socket.CloseEvent(code, reason)));
        yield* Effect.addFinalizer(() => Effect.sync(leave));
      }
      const sent = yield* Effect.exit(listenings.send(id, asked.get('track') ?? 'mic', Stream.flattenArray(Stream.fromEffectRepeat(pull))));
      const failure = Exit.isFailure(sent) ? Cause.findErrorOption(sent.cause) : Option.none();
      const close = Exit.isSuccess(sent)
        ? closing(1000, sent.value)
        : Option.isSome(failure) && failure.value instanceof GateRefusal
          ? closing(POLICY_CLOSE, failure.value.reason)
          : null;
      if (close !== null) {
        const written = yield* Effect.exit(write(close));
        if (Exit.isFailure(written)) yield* Effect.logDebug('a sending socket closed before its close frame', { id });
      }
      return HttpServerResponse.empty();
    }),
  );
