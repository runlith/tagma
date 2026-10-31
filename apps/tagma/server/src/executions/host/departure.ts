import { randomUUID } from 'node:crypto';
import { Duration, Effect, type FileSystem } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey, type HostRequestRef, type InstallationId } from '@runlith/executions/protocol/execution';
import type { QuiescenceTicket } from '@runlith/executions/protocol/runtime';
import type { HostLifetime } from '@runlith/executions/protocol/boot';
import type { Digest } from '@runlith/executions/protocol/artifact';
import type { HostVerdict } from '../../installation/contract/service/steps.js';
import { HostUnprepared } from '../../installation/contract/service/succession.js';
import type { RestartHost } from '../../installation/contract/wire/source.js';
import type { HostPreparationRefused } from '../contract/service/host.js';
import { logicFell, pacedClaim, type StateClaim } from './boot.js';
import type { CustodyAssurance } from './custody.js';
import { candidateOf, candidateRestart, hostBundleNext, hostBundleOwn, placeCandidate, promoteBoot, withdrawCandidate } from './offer.js';

const keyed = (installation: InstallationId, act: string): HostRequestRef => ({
  installation,
  operation: HostRequestKey.make(`host-${act}-${randomUUID()}`),
});

const LOOKED_EVERY = Duration.millis(100);

type Presence =
  | { readonly _tag: 'Answering' }
  | { readonly _tag: 'Vacant' }
  | { readonly _tag: 'Foreign' }
  | { readonly _tag: 'Unread'; readonly detail: string };

const unreadable = (failure: ExecutionsFailure): boolean =>
  failure._tag === 'WireUnreadable' || failure._tag === 'WireInvalid' || failure._tag === 'WireFailed';

const answering = Effect.fnUntraced(function* (
  executions: HostLifecycle['Service'],
  claim: Effect.Effect<StateClaim>,
): Effect.fn.Return<Presence> {
  const held = pacedClaim(claim);
  for (;;) {
    const answered = yield* Effect.result(executions.status());
    if (answered._tag === 'Success' || answered.failure._tag === 'HostRefused') return { _tag: 'Answering' };
    const failure = answered.failure;
    if (failure._tag === 'WireUnavailable' && failure.kind === 'mismatched') return { _tag: 'Foreign' };
    if (unreadable(failure)) return { _tag: 'Unread', detail: `it answers what this server cannot read (${failure._tag})` };
    if ((yield* held)?._tag === 'Free') return { _tag: 'Vacant' };
    yield* Effect.sleep(LOOKED_EVERY);
  }
});

export const prepareChange = Effect.fnUntraced(function* (
  executions: HostLifecycle['Service'],
  custody: Effect.Effect<CustodyAssurance>,
  files: FileSystem.FileSystem,
  state: string,
  installation: InstallationId,
  claim: Effect.Effect<StateClaim>,
  restart: string,
  host: RestartHost = 'hand-over',
): Effect.fn.Return<boolean, HostUnprepared> {
  const unprepared = (failure: HostPreparationRefused) => new HostUnprepared({ detail: failure.detail });
  const pending = yield* candidateOf(files, state).pipe(Effect.mapError(unprepared));
  if (pending === undefined) return false;
  const refused = (detail: string): Effect.Effect<boolean, HostUnprepared> =>
    host === 'replace'
      ? Effect.as(Effect.logWarning(`${detail}; the successor ends the standing host and raises its own`), false)
      : Effect.andThen(withdrawCandidate(files, state), Effect.fail(new HostUnprepared({ detail })));
  const placedBy = yield* candidateRestart(files, state).pipe(Effect.mapError(unprepared));
  if (placedBy !== restart) {
    const named = pending._tag === 'Unread' ? `this build cannot read (${pending.detail})` : pending.digest;
    yield* Effect.logWarning(`a host candidate ${named} stands that the successor of restart ${restart} did not place; it is withdrawn`);
    yield* withdrawCandidate(files, state);
    return false;
  }
  const present = yield* answering(executions, claim);
  if (present._tag === 'Vacant') return false;
  if (present._tag === 'Foreign') {
    yield* Effect.logWarning('the execution host stands at a build this server does not speak to; the successor asks it to yield itself');
    return false;
  }
  if (present._tag === 'Unread') return yield* refused(`the execution host holds its state and cannot be handed over: ${present.detail}`);
  const assured = yield* custody;
  if (assured._tag !== 'Held') {
    yield* Effect.logWarning(
      `this server does not hold the custody of its execution host (${assured.reason._tag}); the successor asks the host to yield itself`,
    );
    return false;
  }
  const answered = yield* Effect.result(executions.prepare(keyed(installation, 'prepare')));
  if (answered._tag === 'Failure') {
    return yield* refused(
      `the execution host could not be asked to prepare its successor: ${answered.failure._tag}: ${answered.failure.message}`,
    );
  }
  const prepared = answered.success;
  switch (prepared._tag) {
    case 'Prepared':
      return true;
    case 'Unprepared':
      return yield* refused(`the execution host could not prepare its successor (${prepared.reason}): ${prepared.detail}`);
    case 'Refused':
      return yield* refused(`the execution host refused to prepare its successor: ${prepared.refusal._tag} — ${prepared.refusal.reason}`);
  }
});

export type Weighing = {
  readonly executions: HostLifecycle['Service'];
  readonly custody: Effect.Effect<CustodyAssurance>;
  readonly files: FileSystem.FileSystem;
  readonly registrations: HostRegistration['Service'];
  readonly state: string;
  readonly installation: InstallationId;
  readonly claim: Effect.Effect<StateClaim>;
  readonly lifetime: HostLifetime | undefined;
  readonly bundle: string;
};

const unasked = (detail: string): HostVerdict => ({ _tag: 'Unasked', detail });

const preparedOf = (installation: InstallationId, executions: HostLifecycle['Service']): Effect.Effect<HostVerdict> =>
  Effect.match(executions.prepare(keyed(installation, 'weigh')), {
    onFailure: (failure) => unasked(`the execution host could not be asked: ${failure._tag}: ${failure.message}`),
    onSuccess: (answer): HostVerdict => {
      switch (answer._tag) {
        case 'Prepared':
          return { _tag: 'Takes' };
        case 'Unprepared':
          return { _tag: 'Refuses', detail: `the execution host could not prepare it (${answer.reason}): ${answer.detail}` };
        case 'Refused':
          return unasked(`the execution host would not be asked: ${answer.refusal._tag} — ${answer.refusal.reason}`);
      }
    },
  });

export const weighBundle = Effect.fn('SuccessionSteps.weigh')(function* (input: Weighing) {
  const { executions, files, state } = input;
  const present = yield* answering(executions, input.claim);
  if (present._tag === 'Vacant') return unasked('no execution host stands to ask');
  if (present._tag === 'Foreign') return unasked('the execution host stands at a build this server does not speak to');
  if (present._tag === 'Unread') return unasked(`the execution host ${present.detail}`);
  const assured = yield* input.custody;
  if (assured._tag !== 'Held') return unasked(`this server does not hold the custody of its execution host (${assured.reason._tag})`);
  const waiting = yield* Effect.match(candidateOf(files, state), {
    onFailure: (refused) => refused.detail,
    onSuccess: (candidate) =>
      candidate === undefined
        ? null
        : `a host candidate already stands at ${hostBundleNext(state)}, and weighing another would take its place`,
  });
  if (waiting !== null) return unasked(waiting);
  return yield* placeCandidate({
    files,
    registrations: input.registrations,
    source: { _tag: 'Closure', path: input.bundle },
    own: hostBundleOwn(state),
    state,
    restart: `weigh-${randomUUID()}`,
    lifetime: input.lifetime,
  }).pipe(
    Effect.flatMap((placement) => {
      switch (placement._tag) {
        case 'Vacant':
          return Effect.succeed(unasked(placement.detail));
        case 'Standing':
          return Effect.succeed<HostVerdict>({ _tag: 'Takes' });
        case 'Placed':
          return preparedOf(input.installation, executions);
      }
    }),
    Effect.catchTag('HostPreparationRefused', (refused) =>
      Effect.succeed<HostVerdict>({ _tag: 'Refuses', detail: `${input.bundle} cannot stand as its candidate: ${refused.detail}` }),
    ),
    Effect.ensuring(withdrawCandidate(files, state)),
  );
});

type LogicReading = { readonly _tag: 'Read'; readonly logic: string | undefined } | { readonly _tag: 'Unread'; readonly detail: string };

const logicOf = (registrations: HostRegistration['Service'], state: string): Effect.Effect<LogicReading> =>
  Effect.match(registrations.read(state), {
    onFailure: (failure) => ({ _tag: 'Unread', detail: failure._tag }) as const,
    onSuccess: (registration) =>
      ({
        _tag: 'Read',
        logic: registration.logic === undefined ? undefined : `${registration.logic.pid}@${registration.logic.birth}`,
      }) as const,
  });

type Departed =
  | { readonly _tag: 'Replaced' }
  | { readonly _tag: 'Yielding' }
  | { readonly _tag: 'Fallen'; readonly detail: string }
  | { readonly _tag: 'Stays'; readonly detail: string };

const departed = Effect.fnUntraced(function* (
  executions: HostLifecycle['Service'],
  files: FileSystem.FileSystem,
  registrations: HostRegistration['Service'],
  state: string,
  leaving: LogicReading,
  awaited: Digest | undefined,
  ticket: QuiescenceTicket,
  claim: Effect.Effect<StateClaim>,
): Effect.fn.Return<Departed> {
  const fell = awaited === undefined ? Effect.succeed(undefined) : logicFell(files, state, awaited);
  const before = leaving._tag === 'Read' ? leaving.logic : undefined;
  const replaced = Effect.map(
    logicOf(registrations, state),
    (standing) => standing._tag === 'Read' && standing.logic !== undefined && standing.logic !== before,
  );
  const held = pacedClaim(claim);
  const reasked = Effect.fnUntraced(function* (): Effect.fn.Return<Departed | undefined> {
    const asked = yield* Effect.result(executions.yield(ticket));
    if (asked._tag === 'Success') {
      const said = asked.success;
      if (said._tag === 'Yielding') return { _tag: 'Yielding' };
      return {
        _tag: 'Stays',
        detail:
          said._tag === 'TicketUnknown'
            ? `asked again, it did not know the quiescence ticket (admission ${said.phase})`
            : `asked again, it refused to yield: ${said.refusal._tag} — ${said.refusal.reason}`,
      };
    }
    const failure = asked.failure;
    if (failure._tag === 'HostRefused') return { _tag: 'Stays', detail: `asked again, it refused: ${failure.refusal.reason}` };
    if (failure._tag === 'WireUnavailable' && failure.kind === 'mismatched') return { _tag: 'Replaced' };
    if (unreadable(failure)) return { _tag: 'Stays', detail: `asked again, it answered what this server cannot read (${failure._tag})` };
    if ((yield* held)?._tag === 'Free')
      return { _tag: 'Stays', detail: 'its holder let go of the state and no other logic took its place' };
    return undefined;
  });
  for (;;) {
    if (yield* replaced) return { _tag: 'Replaced' };
    const cause = yield* fell;
    if (cause !== undefined) return (yield* replaced) ? { _tag: 'Replaced' } : { _tag: 'Fallen', detail: cause };
    const verdict = yield* reasked();
    if (verdict?._tag === 'Stays' && (yield* replaced)) return { _tag: 'Replaced' };
    if (verdict !== undefined) return verdict;
    yield* Effect.sleep(LOOKED_EVERY);
  }
});

const stays = Effect.fnUntraced(function* (
  executions: HostLifecycle['Service'],
  ticket: QuiescenceTicket,
  restore: Effect.Effect<void, HostPreparationRefused>,
  why: string,
) {
  const restored = yield* Effect.result(restore);
  const resumed = yield* Effect.result(executions.resume(ticket));
  const boot = restored._tag === 'Failure' ? `; its boot input could not be put back: ${restored.failure.detail}` : '';
  const admission =
    resumed._tag === 'Failure'
      ? `; it could not be asked to resume (${resumed.failure._tag}: ${resumed.failure.message})`
      : resumed.success._tag === 'Resumed'
        ? ''
        : `; it did not know its ticket on resume (admission ${resumed.success.phase})`;
  yield* Effect.logError(`${why}; its logic stays${boot}${admission}`);
});

export const yieldPlace = Effect.fnUntraced(function* (
  executions: HostLifecycle['Service'],
  files: FileSystem.FileSystem,
  registrations: HostRegistration['Service'],
  state: string,
  installation: InstallationId,
  claim: Effect.Effect<StateClaim>,
) {
  const leaving = yield* logicOf(registrations, state);
  const pending = yield* candidateOf(files, state).pipe(
    Effect.catchTag('HostPreparationRefused', (refused) =>
      Effect.as(
        Effect.logWarning(
          `the candidate of the successor could not be named, so a refusal of its logic at load is not seen: ${refused.detail}`,
        ),
        undefined,
      ),
    ),
  );
  const awaited = pending === undefined || pending._tag === 'Unread' ? undefined : pending.digest;
  const fenced = yield* Effect.result(executions.quiesce(keyed(installation, 'quiesce')));
  if (fenced._tag === 'Failure') {
    return yield* Effect.logError(
      `the execution host could not be quiesced for its successor: ${fenced.failure._tag}: ${fenced.failure.message}; its logic stays`,
    );
  }
  if (fenced.success._tag === 'Refused') {
    const { refusal } = fenced.success;
    return yield* Effect.logError(`the execution host refused to quiesce for its successor: ${refusal._tag} — ${refusal.reason}`);
  }
  const { ticket } = fenced.success;
  const promoted = yield* Effect.result(promoteBoot(files, state));
  if (promoted._tag === 'Failure') {
    return yield* stays(
      executions,
      ticket,
      Effect.void,
      `the boot input of the successor could not take its place: ${promoted.failure.detail}`,
    );
  }
  const restore = promoted.success;
  const answered = yield* Effect.result(executions.yield(ticket));
  if (answered._tag === 'Failure') {
    if (answered.failure._tag !== 'WireLost') {
      return yield* stays(
        executions,
        ticket,
        restore,
        `the execution host logic could not be asked to yield: ${answered.failure._tag}: ${answered.failure.message}`,
      );
    }
    const after = yield* departed(executions, files, registrations, state, leaving, awaited, ticket, claim);
    switch (after._tag) {
      case 'Replaced':
        return yield* Effect.log('the execution host logic closed its connection after Yield and another logic took its place');
      case 'Yielding':
        return yield* Effect.log('the execution host logic closed its connection after Yield and, asked again, yields its place');
      case 'Fallen': {
        const restored = yield* Effect.result(restore);
        return yield* Effect.logError(
          `the execution host logic left after Yield, and ${after.detail}${
            restored._tag === 'Failure' ? `; the boot input before it could not be put back: ${restored.failure.detail}` : ''
          }`,
        );
      }
      case 'Stays':
        return yield* stays(executions, ticket, restore, `the execution host logic closed its connection after Yield; ${after.detail}`);
    }
  }
  const said = answered.success;
  switch (said._tag) {
    case 'Yielding':
      return yield* Effect.log('the execution host logic yields its place to the successor');
    case 'TicketUnknown':
      return yield* stays(
        executions,
        ticket,
        restore,
        `the execution host logic did not know the quiescence ticket (admission ${said.phase})`,
      );
    case 'Refused':
      return yield* stays(
        executions,
        ticket,
        restore,
        `the execution host logic refused to yield: ${said.refusal._tag} — ${said.refusal.reason}`,
      );
  }
});
