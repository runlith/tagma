import { Cause, Effect, Exit, Option, Schema } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import * as Socket from 'effect/socket/Socket';
import { CallDevice } from '../invocation/contract/service/admission.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { DesktopChannel } from './contract/service/channel.js';
import { HostId, REPORT_PATH } from './contract/wire/channel.js';

const POLICY_CLOSE = 1008;

const decodeHost = Schema.decodeUnknownResult(HostId);

const refused = (status: number, refusal: GateRefusal) =>
  HttpServerResponse.jsonUnsafe({ code: refusal.code, reason: refusal.reason, unblock: refusal.unblock }, { status });

export const desktopReportRoute = (channel: DesktopChannel['Service']) =>
  HttpRouter.add('GET', REPORT_PATH, (request) =>
    Effect.gen(function* () {
      if ((yield* CallDevice) !== null) {
        return refused(
          403,
          new GateRefusal('device-refused', 'a desktop host reports only from this machine, not from a paired device', [
            'run the Tagma app on the machine of this server',
          ]),
        );
      }
      const query = new URL(request.url, 'http://localhost').searchParams;
      const host = decodeHost(query.get('host'));
      const generation = Number(query.get('generation'));
      if (host._tag === 'Failure' || !Number.isInteger(generation) || generation < 1) {
        return refused(
          400,
          new GateRefusal('bad-request', 'name the host and its generation: ?host=<id>&generation=<n>', ['report again']),
        );
      }
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const intake = yield* channel.report(host.success, generation);
          const socket = yield* Effect.orDie(request.upgrade);
          const { write } = yield* socket.writer;
          const reader = yield* Effect.orDie(socket.reader);
          const text = new TextDecoder();
          const reading = Effect.gen(function* () {
            for (;;)
              for (const message of yield* reader.pull) yield* intake.take(typeof message === 'string' ? message : text.decode(message));
          });
          const read = yield* Effect.exit(Effect.raceFirst(reading, intake.ended));
          const failure = Exit.isFailure(read) ? Cause.findErrorOption(read.cause) : Option.none();
          if (Option.isSome(failure) && failure.value instanceof GateRefusal) {
            const closed = yield* Effect.exit(write(new Socket.CloseEvent(POLICY_CLOSE, failure.value.reason.slice(0, 120))));
            if (Exit.isFailure(closed)) yield* Effect.logDebug('a desktop report socket closed before its close frame');
          }
          return HttpServerResponse.empty();
        }),
      ).pipe(Effect.catchTag('GateRefusal', (refusal) => Effect.succeed(refused(404, refusal))));
    }),
  );
