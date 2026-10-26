import { Data, Context, Deferred, Effect, Layer, Ref, Schema, type Scope } from 'effect';
import { AdmissionPhase, narrower } from '@runlith/executions/protocol/registration';

export const RequestKind = Schema.Literals(['read', 'stop', 'durable']);
export type RequestKind = typeof RequestKind.Type;

export class AdmissionRefused extends Data.TaggedError('AdmissionRefused')<{
  readonly phase: AdmissionPhase;
  readonly kind: RequestKind;
}> {
  override get message(): string {
    return `${this.kind} requests are refused while admission is ${this.phase}`;
  }
}

export type AdmissionPopulations = { readonly starts: number; readonly attempts: number };

export class HostAdmission extends Context.Service<
  HostAdmission,
  {
    readonly admit: (kind: RequestKind) => Effect.Effect<AdmissionPhase, AdmissionRefused>;
    readonly admitStart: () => Effect.Effect<AdmissionPhase, AdmissionRefused, Scope.Scope>;
    readonly awaitStarts: () => Effect.Effect<void>;
    readonly admitAttempt: () => Effect.Effect<AdmissionPhase, AdmissionRefused, Scope.Scope>;
    readonly awaitAttempts: () => Effect.Effect<void>;
    readonly populations: () => Effect.Effect<AdmissionPopulations>;
    readonly fence: () => Effect.Effect<AdmissionPhase>;
    readonly stopping: () => Effect.Effect<AdmissionPhase>;
    readonly close: () => Effect.Effect<AdmissionPhase>;
    readonly phase: () => Effect.Effect<AdmissionPhase>;
  }
>()('@runlith/execution-host/HostAdmission') {
  static layer(phase: AdmissionPhase) {
    return Layer.effect(HostAdmission, make({ phase }));
  }
}

const admitted: Record<AdmissionPhase, ReadonlyArray<RequestKind>> = {
  open: ['read', 'stop', 'durable'],
  fenced: ['read', 'stop'],
  stopping: ['read', 'stop'],
  closed: [],
};

type Gate = {
  readonly phase: AdmissionPhase;
  readonly starts: number;
  readonly attempts: number;
  readonly startsSettled: Deferred.Deferred<void> | undefined;
  readonly attemptsSettled: Deferred.Deferred<void> | undefined;
};

type AdmissionInput = { readonly phase: AdmissionPhase };
const make = Effect.fn('HostAdmission.make')(function* ({ phase }: AdmissionInput) {
  const state = yield* Ref.make<Gate>({ phase, starts: 0, attempts: 0, startsSettled: undefined, attemptsSettled: undefined });
  const enter = (next: AdmissionPhase) =>
    Effect.map(
      Ref.updateAndGet(state, (gate) => ({ ...gate, phase: narrower(gate.phase, next) })),
      (gate) => gate.phase,
    );

  const left = Effect.flatten(
    Ref.modify(state, (gate): readonly [Effect.Effect<void>, Gate] => {
      const starts = Math.max(0, gate.starts - 1);
      return starts === 0 && gate.startsSettled !== undefined
        ? [Effect.asVoid(Deferred.succeed(gate.startsSettled, undefined)), { ...gate, starts, startsSettled: undefined }]
        : [Effect.void, { ...gate, starts }];
    }),
  );

  const attemptLeft = Effect.flatten(
    Ref.modify(state, (gate): readonly [Effect.Effect<void>, Gate] => {
      const attempts = Math.max(0, gate.attempts - 1);
      return attempts === 0 && gate.attemptsSettled !== undefined
        ? [Effect.asVoid(Deferred.succeed(gate.attemptsSettled, undefined)), { ...gate, attempts, attemptsSettled: undefined }]
        : [Effect.void, { ...gate, attempts }];
    }),
  );

  return HostAdmission.of({
    admit: (kind) =>
      Effect.flatMap(Ref.get(state), (gate) =>
        admitted[gate.phase].includes(kind) ? Effect.succeed(gate.phase) : Effect.fail(new AdmissionRefused({ phase: gate.phase, kind })),
      ),

    admitStart: () =>
      Effect.acquireRelease(
        Effect.flatten(
          Ref.modify(state, (gate): readonly [Effect.Effect<AdmissionPhase, AdmissionRefused>, Gate] =>
            admitted[gate.phase].includes('durable')
              ? [Effect.succeed(gate.phase), { ...gate, starts: gate.starts + 1 }]
              : [Effect.fail(new AdmissionRefused({ phase: gate.phase, kind: 'durable' })), gate],
          ),
        ),
        () => left,
      ),

    awaitStarts: () =>
      Effect.flatten(
        Ref.modify(state, (gate): readonly [Effect.Effect<void>, Gate] => {
          if (gate.starts === 0) return [Effect.void, gate];
          const startsSettled = gate.startsSettled ?? Deferred.makeUnsafe<void>();
          return [Deferred.await(startsSettled), { ...gate, startsSettled }];
        }),
      ),

    admitAttempt: () =>
      Effect.acquireRelease(
        Effect.flatten(
          Ref.modify(state, (gate): readonly [Effect.Effect<AdmissionPhase, AdmissionRefused>, Gate] =>
            admitted[gate.phase].includes('durable')
              ? [Effect.succeed(gate.phase), { ...gate, attempts: gate.attempts + 1 }]
              : [Effect.fail(new AdmissionRefused({ phase: gate.phase, kind: 'durable' })), gate],
          ),
        ),
        () => attemptLeft,
      ),

    awaitAttempts: () =>
      Effect.flatten(
        Ref.modify(state, (gate): readonly [Effect.Effect<void>, Gate] => {
          if (gate.attempts === 0) return [Effect.void, gate];
          const attemptsSettled = gate.attemptsSettled ?? Deferred.makeUnsafe<void>();
          return [Deferred.await(attemptsSettled), { ...gate, attemptsSettled }];
        }),
      ),

    populations: () => Effect.map(Ref.get(state), (gate) => ({ starts: gate.starts, attempts: gate.attempts })),

    fence: () => enter('fenced'),
    stopping: () => enter('stopping'),
    close: () => enter('closed'),
    phase: () => Effect.map(Ref.get(state), (gate) => gate.phase),
  });
});
