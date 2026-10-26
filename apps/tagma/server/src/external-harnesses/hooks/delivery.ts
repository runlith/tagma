import { Context, Duration, Effect, Schedule } from 'effect';
import type { PerformRequest } from '../../platform/contract/service/perform.js';
import { HttpClientError } from 'effect/http';
import { CurrentInvocation, type Invocation } from '../../platform/cli/verb.js';
import type { TouchBrief } from '../../graph/contract/service/orientation.js';
import type { Place } from '../../platform/contract/wire/place.js';
import type { ToolShown } from '@runlith/agent/tool';
import type { HarnessAdopted, HarnessAdoptInput } from '../contract/wire/adoption.js';
import { RUN_UNOWNED } from '../contract/wire/call.js';
import type { HOOK_OPERATIONS } from '../contract/wire/hooks.js';
import type { HarnessCall, HarnessDecision, harnessCallAnswerSchema } from '../contract/wire/call.js';
import type { HarnessReceipt, HarnessReportInput } from '../../threads/contract/wire/harness/observation.js';

type Cwd = { readonly cwd: string };

export type HarnessGuideInput = (typeof HOOK_OPERATIONS.guide_harness)['input']['Type'];
export type HarnessGuided = { readonly text: string | null };

export type HookDoor = {
  readonly orientation: {
    readonly sessionStart: (request: { readonly query: Cwd }) => Effect.Effect<string, unknown>;
    readonly touch: (request: {
      readonly query: Cwd;
      readonly shown: readonly ToolShown[];
    }) => Effect.Effect<{ readonly briefs: readonly TouchBrief[]; readonly places: readonly Place[] }, unknown>;
  };
  readonly harness: {
    readonly report: (request: { readonly payload: HarnessReportInput }) => Effect.Effect<HarnessReceipt, unknown>;
    readonly permission: (request: { readonly payload: HarnessCall }) => Effect.Effect<HarnessDecision, unknown>;
    readonly permissionOutcome: (request: {
      readonly payload: { readonly requestId: string };
    }) => Effect.Effect<typeof harnessCallAnswerSchema.Type, unknown>;
    readonly guide: (request: { readonly payload: HarnessGuideInput }) => Effect.Effect<HarnessGuided, unknown>;
    readonly adopt: (request: { readonly query: Cwd; readonly payload: HarnessAdoptInput }) => Effect.Effect<HarnessAdopted, unknown>;
  };
  readonly operations: {
    readonly perform: (request: PerformRequest) => Effect.Effect<unknown, unknown>;
  };
  readonly changes: {
    readonly record: (request: {
      readonly query: Cwd;
      readonly payload: {
        readonly cwd: string;
        readonly path: string;
        readonly before: string | null;
        readonly after: string | null;
        readonly key?: string;
      };
    }) => Effect.Effect<unknown, unknown>;
  };
};

export type HookConnect = (at: Invocation) => Effect.Effect<HookDoor>;

export type Delivered<A> =
  | { readonly _tag: 'Answered'; readonly value: A }
  | { readonly _tag: 'Refused'; readonly code: string; readonly reason: string }
  | { readonly _tag: 'Unreachable'; readonly detail: string }
  | { readonly _tag: 'Cut' };

export const PERMISSION_LOOK_MS = 11_000;

export const PERMISSION_RETRY_MS = 1_000;

const IDEMPOTENT_ATTEMPTS = 3;

const OWNED_ATTEMPTS = 4;

const OWNED_RETRY_MS = 250;

const classified = <A, E>(failure: E): Delivered<A> => {
  if (HttpClientError.isHttpClientError(failure)) {
    return { _tag: 'Unreachable', detail: `${failure.reason._tag}: ${failure.message}` };
  }
  const said = failure as { readonly code?: unknown; readonly reason?: unknown };
  return typeof said.code === 'string' && typeof said.reason === 'string'
    ? { _tag: 'Refused', code: said.code, reason: said.reason }
    : { _tag: 'Unreachable', detail: failure instanceof Error ? failure.message : String(failure) };
};

type Call<A, E> = (door: HookDoor) => Effect.Effect<A, E>;

export class HookDelivery extends Context.Service<
  HookDelivery,
  {
    send<A, E>(call: Call<A, E>): Effect.Effect<Delivered<A>>;
    hold<A, E>(call: Call<A, E>, waitMs?: number): Effect.Effect<Delivered<A>>;
    idempotent<A, E>(call: Call<A, E>): Effect.Effect<A | undefined>;
    answered<A, E>(call: Call<A, E>): Effect.Effect<A | undefined>;
  }
>()('tagma/external-harnesses/HookDelivery') {}

export const makeHookDelivery = ({ connect }: { readonly connect: HookConnect }) => {
  const once = <A, E>(call: Call<A, E>): Effect.Effect<Delivered<A>> =>
    Effect.flatMap(CurrentInvocation, connect).pipe(
      Effect.flatMap(call),
      Effect.match({
        onFailure: (failure) => classified<A, E>(failure),
        onSuccess: (value): Delivered<A> => ({ _tag: 'Answered', value }),
      }),
      Effect.catchDefect((defect) =>
        Effect.succeed<Delivered<A>>({ _tag: 'Unreachable', detail: defect instanceof Error ? defect.message : String(defect) }),
      ),
    );

  const send = Effect.fn('HookDelivery.send')(function* <A, E>(call: Call<A, E>) {
    return yield* once(call).pipe(
      Effect.flatMap((delivered) =>
        delivered._tag === 'Refused' && delivered.code === RUN_UNOWNED ? Effect.fail(delivered) : Effect.succeed(delivered),
      ),
      Effect.retry({ times: OWNED_ATTEMPTS - 1, schedule: Schedule.spaced(OWNED_RETRY_MS) }),
      Effect.catchTag('Refused', (delivered) => Effect.succeed(delivered)),
    );
  });

  return HookDelivery.of({
    send,
    hold: (call, waitMs = PERMISSION_LOOK_MS) =>
      once(call).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(Math.min(waitMs, PERMISSION_LOOK_MS)),
          orElse: () => Effect.succeed<Delivered<never>>({ _tag: 'Cut' }),
        }),
        Effect.withSpan('HookDelivery.hold'),
      ),
    idempotent: (call) =>
      send(call).pipe(
        Effect.flatMap((delivered) => (delivered._tag === 'Unreachable' ? Effect.fail(delivered) : Effect.succeed(delivered))),
        Effect.retry({ times: IDEMPOTENT_ATTEMPTS - 1 }),
        Effect.catchTag('Unreachable', (delivered) => Effect.succeed(delivered)),
        Effect.map((delivered) => (delivered._tag === 'Answered' ? delivered.value : undefined)),
      ),
    answered: (call) => Effect.map(send(call), (delivered) => (delivered._tag === 'Answered' ? delivered.value : undefined)),
  });
};
