import { Clock, Deferred, Duration, Effect, FileSystem, Ref, Schema, Semaphore } from 'effect';
import { partOf, verifyArtifact, type ArtifactFailure } from '@runlith/executions/hostArtifacts';
import { bootPath, yieldRefusalPath } from '@runlith/executions/protocol/boot';
import { HostRequestRef } from '@runlith/executions/protocol/execution';
import type { StreamPositions } from '@runlith/executions/protocol/record';
import type { Refusal } from '@runlith/executions/protocol/host';
import type { PrepareAnswer, QuiescenceTicket, YieldAnswer } from '@runlith/executions/protocol/runtime';
import { checkpointScreen } from '../checkpointFile';
import { endAccepted } from './commands';
import { endedStreams } from './work';
import { commanding, type HostClaim, type Live, type RegistryState } from './state';

const STANDING = 'bundle';
const NEXT = 'bundle.next';

const artifactDetail = (failure: ArtifactFailure): string =>
  failure._tag === 'ArtifactMissing'
    ? `no artifact manifest stands in ${failure.root}`
    : failure._tag === 'ArtifactInvalid'
      ? failure.reason === 'mismatch'
        ? `${failure.path}: expected ${failure.expected} and found ${failure.found}`
        : `${failure.root}: ${failure.detail}`
      : `${failure.path}: ${failure.detail}`;

const prepare = (registry: RegistryState, claim: HostClaim, operation: HostRequestRef): Effect.Effect<PrepareAnswer> =>
  Effect.flatMap(Effect.result(commanding(registry, claim, 'start')), (allowed) =>
    allowed._tag === 'Failure'
      ? Effect.succeed({
          _tag: 'Refused',
          operation,
          refusal: { _tag: 'Unauthorized', reason: `the presented custody is not the one that stands: ${allowed.failure._tag}` },
        } satisfies PrepareAnswer)
      : Effect.flatMap(broken(registry), (unheld) => candidateChecked(registry, operation, unheld)),
  );

const broken = (registry: RegistryState) => Effect.map(Ref.get(registry.lost), (loss) => loss?.reason === 'broken');

const candidateChecked = Effect.fn('HostLifecycle.candidateChecked')(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  unheld: boolean,
) {
  const { fs, path, store, holder, entered } = registry;
  const unprepared = (reason: Extract<PrepareAnswer, { readonly _tag: 'Unprepared' }>['reason'], detail: string): PrepareAnswer => ({
    _tag: 'Unprepared',
    operation,
    reason,
    detail,
  });
  const state = entered.registration.state;
  const next = path.join(state, NEXT);
  const checkpoints = yield* checkpointed(registry);
  if (checkpoints._tag === 'Unprepared') return unprepared('checkpoint', checkpoints.detail);
  const prepared = { _tag: 'Prepared', operation, checkpoints: checkpoints.taken, unquiet: checkpoints.unquiet } satisfies PrepareAnswer;
  const bundled = yield* Effect.result(fs.exists(next));
  if (bundled._tag === 'Failure') return unprepared('bundle', `${next} could not be read: ${bundled.failure.message}`);
  if (!bundled.success) return prepared;
  const verified = yield* Effect.result(Effect.provideService(verifyArtifact(next), FileSystem.FileSystem, fs));
  if (verified._tag === 'Failure') return unprepared('bundle', artifactDetail(verified.failure));
  const manifest = verified.success;
  const [runtime, host, holderPart, metadata] = (['runtime', 'host', 'holder', 'metadata'] as const).map((role) => partOf(manifest, role));
  if (runtime === undefined || host === undefined || holderPart === undefined || metadata === undefined) {
    return unprepared('bundle', `${next} does not name its runtime, host, holder and migrations`);
  }
  const chain = yield* Effect.result(store.continuedBy(path.join(next, metadata.path.split('/')[0]!)));
  if (chain._tag === 'Failure') return unprepared('migrations', `the applied migrations could not be read: ${chain.failure._tag}`);
  if (chain.success._tag === 'Diverges') return unprepared('migrations', chain.success.detail);
  const boot = bootPath(state, manifest.identity.digest);
  const booted = yield* Effect.result(fs.exists(boot));
  if (booted._tag === 'Failure')
    return unprepared('bundle', `the boot entry ${boot} of ${next} could not be read: ${booted.failure.message}`);
  if (!booted.success) return unprepared('bundle', `the boot entry ${boot} of ${next} does not stand`);
  if (unheld) return prepared;
  const standing = path.join(state, STANDING);
  const handed = yield* Effect.result(
    holder.prepare({ holder: holderPart.path, logic: [path.join(standing, runtime.path), path.join(standing, host.path), boot] }),
  );
  if (handed._tag === 'Failure') return unprepared('holder', `${handed.failure.reason}: ${handed.failure.detail}`);
  return prepared;
});

type Checkpointed =
  | { readonly _tag: 'Checkpointed'; readonly taken: number; readonly unquiet: number }
  | { readonly _tag: 'Unprepared'; readonly detail: string };

const checkpointed = Effect.fn('HostLifecycle.checkpointed')(function* (registry: RegistryState) {
  const { fs, path, held } = registry;
  let taken = 0;
  let unquiet = 0;
  for (const found of held.all()) {
    const interpretation = found.execution.interpretation;
    if (interpretation === undefined) continue;
    const written = yield* checkpointScreen(fs, path, found.execution.record.directory, interpretation).pipe(
      Effect.map((wrote) => (wrote ? ('taken' as const) : ('unquiet' as const))),
      Effect.catchTag('InterpretationUnavailable', () => Effect.succeed('unquiet' as const)),
      Effect.result,
    );
    if (written._tag === 'Failure')
      return { _tag: 'Unprepared', detail: `${found.ref.execution}: ${written.failure.detail}` } satisfies Checkpointed;
    if (written.success === 'taken') taken += 1;
    else unquiet += 1;
  }
  return { _tag: 'Checkpointed', taken, unquiet } satisfies Checkpointed;
});

const LEAVING_MS = 3_000;

const reported = <E extends { readonly _tag: string }>(what: string, work: Effect.Effect<void, E>): Effect.Effect<void> =>
  Effect.flatMap(Effect.result(work), (done) =>
    done._tag === 'Failure' ? Effect.logError(`the yielding logic could not ${what}: ${done.failure._tag}`, done.failure) : Effect.void,
  );

const depart = Effect.fn('HostLifecycle.depart')(function* (registry: RegistryState, found: Live) {
  const { store } = registry;
  const execution = found.ref.execution;
  const clock = yield* Clock.Clock;
  const deadline = clock.currentTimeMillisUnsafe() + LEAVING_MS;
  const left = () => Duration.millis(Math.max(0, deadline - clock.currentTimeMillisUnsafe()));
  const within = (what: string, work: Effect.Effect<void>) =>
    Effect.flatMap(Effect.timeoutOption(work, left()), (done) =>
      done._tag === 'None'
        ? Effect.logWarning(`${execution} did not ${what} within ${LEAVING_MS}ms; its departure is taken as it stands`)
        : Effect.void,
    );
  yield* within('stop reading', found.stopReading);
  const interpretation = found.execution.interpretation;
  if (interpretation !== undefined) yield* within('settle its terminal replies', interpretation.settleReplies);
  const input = yield* found.execution.input.halt(left());
  const departure = {
    input,
    parsed: interpretation === undefined ? undefined : yield* interpretation.parsedThrough,
    descendants: found.native.proven === undefined ? [] : yield* found.native.proven.descendants,
    echoes: yield* found.native.pendingEchoes,
  };
  const recorded = yield* Effect.result(store.recordDeparture({ execution: found.ref, departure }));
  if (recorded._tag === 'Failure') {
    yield* reported(
      `record that the departure of ${execution} was lost`,
      store.recordLoss(execution, `the yielding logic could not record its departure: ${recorded.failure._tag}`),
    );
  }
  const unjournaled = Effect.fnUntraced(function* (ended: ReadonlyArray<StreamPositions>) {
    const sources = ended.filter((positions) => positions.stream !== 'output');
    if (sources.length === 0) return;
    const moved = yield* Ref.updateAndGet(found.state, (held) =>
      sources.reduce((state, positions) => ({ ...state, streams: endedStreams(state, positions.stream, positions.ending) }), held),
    );
    yield* reported(`record the stream endings of ${execution} its journal lacks`, store.recordState(moved, yield* Ref.get(found.process)));
  });
  yield* found.execution.record.suspend().pipe(
    Effect.matchEffect({
      onFailure: (failure) => Effect.logError(`the yielding logic could not suspend the record of ${execution}: ${failure._tag}`, failure),
      onSuccess: unjournaled,
    }),
  );
});

const unreleased = (registry: RegistryState, found: Live): Effect.Effect<void> =>
  Effect.andThen(
    Ref.update(found.reading, (reading) => ({ ...reading, fenced: true })),
    Effect.suspend(() => {
      const gate = registry.shelf.gate(found.ref.execution);
      return gate === undefined ? Effect.void : Effect.asVoid(Effect.timeoutOption(Deferred.await(gate), Duration.millis(LEAVING_MS)));
    }),
  );

const leave = Effect.fn('HostLifecycle.leave')(function* (registry: RegistryState, trigger: string) {
  const { admission, held, queued, store } = registry;
  const closeIntakes = (executions: ReadonlyArray<Live>) =>
    Effect.forEach(executions, (found) => found.execution.input.closeIntake(), { concurrency: 'unbounded', discard: true });
  yield* admission.fence();
  yield* closeIntakes(held.all());
  yield* admission.awaitStarts();
  for (const waiting of [...(yield* Ref.get(queued)).values()]) yield* endAccepted(registry, waiting, 'not-started', trigger);
  yield* admission.awaitAttempts();
  yield* Effect.forEach(held.all(), (found) => unreleased(registry, found), { concurrency: 'unbounded', discard: true });
  const executions = held.all();
  yield* closeIntakes(executions);
  yield* Effect.forEach(executions, (found) => depart(registry, found), { concurrency: 'unbounded', discard: true });
  yield* reported('hand its store over', store.handover());
});

export type Departure = {
  readonly prepare: (claim: HostClaim, operation: HostRequestRef) => Effect.Effect<PrepareAnswer>;
  readonly yield: (ticket: QuiescenceTicket) => Effect.Effect<YieldAnswer>;
  readonly askedToYield: Effect.Effect<void>;
  readonly shuttingDown: Effect.Effect<boolean>;
  readonly yielded: Effect.Effect<boolean>;
  readonly leaving: Effect.Effect<void>;
  readonly departed: Effect.Effect<boolean>;
  readonly channelLost: Effect.Effect<void>;
};

type Activation = { readonly _tag: 'Departing' } | { readonly _tag: 'Refused'; readonly refusal: Refusal };

const decodeOperation = Schema.decodeUnknownEffect(HostRequestRef);

export const departure = (registry: RegistryState): Departure => {
  const { admission, quiescence, holder, lost, registryScope, fs, path, entered } = registry;
  const accepted = Deferred.makeUnsafe<void>();
  const over = Deferred.makeUnsafe<void>();
  const gate = Semaphore.makeUnsafe(1);
  const ending = Ref.makeUnsafe<'open' | 'yield' | 'shutdown'>('open');
  const unannounced = Ref.makeUnsafe(false);

  const depart = Effect.fnUntraced(function* (reason: string, permitted: boolean) {
    yield* Ref.set(unannounced, permitted);
    yield* Deferred.succeed(accepted, undefined);
    yield* Effect.forkIn(Effect.ensuring(leave(registry, reason), Deferred.succeed(over, undefined)), registryScope);
  });

  const activated = Effect.fn('HostLifecycle.activate')(function* (reason: string) {
    const loss = yield* Ref.get(lost);
    if (loss?.reason === 'gone') return { _tag: 'Refused', refusal: { _tag: 'HolderLost', reason: loss.detail } } satisfies Activation;
    const claimed = yield* Ref.modify(ending, (now) => (now === 'shutdown' ? [false, now] : [true, 'yield' as const]));
    if (!claimed) {
      return {
        _tag: 'Refused',
        refusal: { _tag: 'HostConflict', reason: 'a shutdown of this host is running, so it cannot yield its place' },
      } satisfies Activation;
    }
    const activation = loss === undefined ? yield* Effect.result(holder.activate) : undefined;
    const unheld =
      activation === undefined ||
      (activation._tag === 'Failure' && activation.failure.reason === 'lost' && (yield* holder.lost).reason === 'broken');
    if (
      !unheld &&
      activation?._tag === 'Failure' &&
      activation.failure.reason !== 'invalid' &&
      activation.failure.reason !== 'unsupported'
    ) {
      yield* Ref.set(ending, 'open');
      return {
        _tag: 'Refused',
        refusal: {
          _tag: activation.failure.reason === 'lost' ? 'HolderLost' : 'HostUnavailable',
          reason: `the holder refused to activate the next bundle: ${activation.failure.detail}`,
        },
      } satisfies Activation;
    }
    yield* depart(reason, unheld);
    return { _tag: 'Departing' } satisfies Activation;
  });

  const state = entered.registration.state;
  const refuse = (detail: string) =>
    Effect.flatMap(Effect.result(fs.writeFileString(yieldRefusalPath(state), `${detail}\n`)), (written) =>
      written._tag === 'Failure'
        ? Effect.logError(`the refusal of the asked yield could not be written: ${detail}`, written.failure)
        : Effect.logWarning(`the asked yield was refused: ${detail}`),
    );

  return {
    prepare: (claim, operation) => prepare(registry, claim, operation),
    shuttingDown: Ref.modify(ending, (now) => (now === 'yield' ? [false, now] : [true, 'shutdown' as const])),
    yield: (ticket) =>
      gate.withPermits(1)(
        Effect.gen(function* () {
          const phase = yield* admission.phase();
          const open = yield* Ref.get(quiescence);
          if (open === undefined || open.ticket !== ticket || phase === 'closed') {
            return { _tag: 'TicketUnknown', ticket, phase } satisfies YieldAnswer;
          }
          if (yield* Deferred.isDone(accepted)) return { _tag: 'Yielding', ticket } satisfies YieldAnswer;
          const activation = yield* activated(`yield:${ticket}`);
          return activation._tag === 'Departing'
            ? ({ _tag: 'Yielding', ticket } satisfies YieldAnswer)
            : ({ _tag: 'Refused', ticket, refusal: activation.refusal } satisfies YieldAnswer);
        }),
      ),
    askedToYield: gate.withPermits(1)(
      Effect.gen(function* () {
        if ((yield* Deferred.isDone(accepted)) || (yield* Ref.get(ending)) !== 'open') return;
        const phase = yield* admission.phase();
        if (phase === 'fenced') return yield* refuse('its admission is fenced, and a yield signal does not open it');
        if (phase !== 'open') return;
        const candidate = yield* Effect.result(fs.exists(path.join(state, NEXT)));
        if (candidate._tag === 'Failure') return yield* refuse(`${NEXT} could not be read: ${candidate.failure.message}`);
        if (!candidate.success) return yield* refuse(`no candidate stands at ${NEXT}`);
        const operation = yield* decodeOperation({
          installation: entered.installation,
          operation: `yield-asked:${crypto.randomUUID()}`,
        }).pipe(Effect.orDie);
        const checked = yield* candidateChecked(registry, operation, yield* broken(registry));
        if (checked._tag === 'Unprepared') return yield* refuse(`${checked.reason}: ${checked.detail}`);
        if (checked._tag === 'Refused') return yield* refuse(`${checked.refusal._tag}: ${checked.refusal.reason}`);
        const activation = yield* activated(operation.operation);
        if (activation._tag === 'Refused') yield* refuse(`${activation.refusal._tag}: ${activation.refusal.reason}`);
      }),
    ),
    channelLost: gate.withPermits(1)(
      Effect.gen(function* () {
        if (yield* Deferred.isDone(accepted)) return;
        const claimed = yield* Ref.modify(ending, (now) => (now === 'open' ? [true, 'yield' as const] : [false, now]));
        if (!claimed) return;
        const operation = yield* decodeOperation({
          installation: entered.installation,
          operation: `channel-lost:${crypto.randomUUID()}`,
        }).pipe(Effect.orDie);
        const candidate = yield* Effect.result(fs.exists(path.join(state, NEXT)));
        if (candidate._tag === 'Failure') {
          yield* refuse(`${NEXT} could not be read: ${candidate.failure.message}`);
          return yield* depart(operation.operation, false);
        }
        if (!candidate.success) return yield* depart(operation.operation, false);
        const checked = yield* candidateChecked(registry, operation, true);
        if (checked._tag === 'Unprepared') yield* refuse(`${checked.reason}: ${checked.detail}`);
        yield* depart(operation.operation, checked._tag === 'Prepared');
      }),
    ),
    yielded: Deferred.isDone(accepted),
    leaving: Deferred.await(accepted),
    departed: Effect.andThen(Deferred.await(over), Ref.get(unannounced)),
  };
};
