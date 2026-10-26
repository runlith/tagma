import { realpathSync } from 'node:fs';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { classify, type Envelope, frame } from '@runlith/ndjson-rpc/envelope';
import { Data, Deferred, Effect, FiberMap, Queue, Schema, Stream } from 'effect';
import { makeWorkspace } from './engine/workspace';
import { Asking, Attached, Cancelled, Dropped, Limited, METHODS, Touched } from './wire';

class EngineFailed extends Data.TaggedError('EngineFailed')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const INVALID = -32602;
const UNKNOWN = -32601;
const FAILED = -32000;

const said = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const main = Effect.gen(function* () {
  const given = process.argv[2];
  if (given === undefined) return yield* new EngineFailed({ detail: 'the engine was started without a base checkout' });
  yield* Effect.try({
    try: () => realpathSync(given),
    catch: (cause) => new EngineFailed({ detail: `the base checkout ${given} cannot be read: ${said(cause)}` }),
  });
  const outbox = yield* Queue.unbounded<Envelope>();
  const failure = yield* Deferred.make<never, EngineFailed>();
  const send = (envelope: Envelope) => Queue.offerUnsafe(outbox, envelope);
  yield* Effect.forkScoped(
    Stream.fromQueue(outbox).pipe(Stream.runForEach((envelope) => Effect.promise(() => Bun.write(Bun.stdout, frame(envelope))))),
  );
  const workspace = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        makeWorkspace(given, process.argv[3], {
          standing: (params) => send({ _tag: 'Notification', method: METHODS.standing, params }),
          drifted: (params) => send({ _tag: 'Notification', method: METHODS.drifted, params }),
          refused: (params) => send({ _tag: 'Notification', method: METHODS.refused, params }),
          failed: (detail) => Deferred.doneUnsafe(failure, Effect.fail(new EngineFailed({ detail }))),
        }),
      catch: (cause) => new EngineFailed({ detail: `TypeScript could not load ${given}: ${said(cause)}` }),
    }),
    (opened) => Effect.promise(() => opened.close()),
  );
  const asks = yield* FiberMap.make<string | number>();

  const answer = (id: string | number, asking: Asking) =>
    Effect.tryPromise({
      try: (signal) => workspace.ask(asking, signal),
      catch: (cause) => new EngineFailed({ detail: said(cause) }),
    }).pipe(
      Effect.match({
        onSuccess: (result) => send({ _tag: 'Result', id, result }),
        onFailure: (failed) => send({ _tag: 'Error', id, error: { code: FAILED, message: failed.detail } }),
      }),
    );

  const decoded = <A>(schema: Schema.Decoder<A>, params: unknown, what: string) =>
    Schema.decodeUnknownEffect(schema)(params).pipe(
      Effect.mapError((invalid) => new EngineFailed({ detail: `${what} could not be read: ${invalid.message}` })),
    );

  const handle = Effect.fnUntraced(function* (line: string) {
    const message = classify(line);
    if (message === null || message._tag === 'Malformed' || message._tag === 'Result' || message._tag === 'Error') return;
    if (message._tag === 'Request') {
      if (message.method !== METHODS.ask) {
        send({ _tag: 'Error', id: message.id, error: { code: UNKNOWN, message: `unknown method ${message.method}` } });
        return;
      }
      const id = message.id;
      yield* Schema.decodeUnknownEffect(Asking)(message.params).pipe(
        Effect.matchEffect({
          onFailure: (invalid) => Effect.sync(() => send({ _tag: 'Error', id, error: { code: INVALID, message: invalid.message } })),
          onSuccess: (asking) => FiberMap.run(asks, id, answer(id, asking)).pipe(Effect.asVoid),
        }),
      );
      return;
    }
    switch (message.method) {
      case METHODS.attach:
        workspace.attach((yield* decoded(Attached, message.params, 'an attach')).checkout);
        return;
      case METHODS.detach:
        workspace.detach((yield* decoded(Attached, message.params, 'a detach')).checkout);
        return;
      case METHODS.rest:
        workspace.rest((yield* decoded(Attached, message.params, 'a rest')).checkout);
        return;
      case METHODS.drop: {
        const dropped = yield* decoded(Dropped, message.params, 'a release');
        workspace.drop(dropped.checkout, dropped.revision);
        return;
      }
      case METHODS.touch:
        workspace.touch(yield* decoded(Touched, message.params, 'a touch'));
        return;
      case METHODS.limit:
        workspace.limit((yield* decoded(Limited, message.params, 'a memory limit')).bytes);
        return;
      case METHODS.cancel:
        yield* FiberMap.remove(asks, (yield* decoded(Cancelled, message.params, 'a cancel')).id);
    }
  });

  const reading = Stream.fromReadableStream({
    evaluate: () => Bun.stdin.stream(),
    onError: (cause) => new EngineFailed({ detail: `the holder's pipe failed: ${said(cause)}` }),
  }).pipe(Stream.decodeText, Stream.splitLines, Stream.runForEach(handle));

  yield* Effect.raceFirst(reading, Deferred.await(failure));
});

BunRuntime.runMain(Effect.scoped(main));
