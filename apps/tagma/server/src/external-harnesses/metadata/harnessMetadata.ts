import { Clock, Context, Effect, Exit, Fiber, Queue, Scope } from 'effect';
import { declare } from '@runlith/held/Held';
import { Holding } from '@runlith/held/holding';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import type { HarnessFields } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { HarnessObservations } from '../observations/admission.js';
import type { Discharge } from '../../executions/contract/service/discharge.js';
import type { ExecutionRecords, TerminalScreens } from '../../executions/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { Environments } from '../../workspace/contract/service/environments.js';
import { MetadataBackend, type MetadataRead } from './runtime.js';
import { MetadataIndex } from './sessionIndex.js';
import { readHarnessTranscript } from './words.js';
import { METADATA_CADENCE, METADATA_CONCURRENCY, METADATA_LIMITS, METADATA_PAGES } from './policy.js';
import type { MetadataInput } from './input.js';

type Job = { readonly key: string; boundary: string; readonly wake: Queue.Queue<void>; fiber: Fiber.Fiber<void> | null };

const jobsHeld = declare<string>({
  name: 'external-harnesses/metadata-jobs',
  owner: 'external-harnesses',
  rank: 900,
  key: () => 'jobs',
  concurrency: 1,
  threshold: '30 seconds',
  ceilings: {
    hold: '5 minutes',
    wait: '5 minutes',
    leaves:
      'a cut job change stops where it stood; the job table keeps its last consistent entry and the next observation of the thread reconciles it',
  },
  external: 'none',
});

const slotsHeld = declare<string>({
  name: 'external-harnesses/metadata-slots',
  owner: 'external-harnesses',
  rank: 400,
  key: () => 'slot',
  concurrency: METADATA_CONCURRENCY,
  threshold: '10 seconds',
  ceilings: {
    hold: '1 minute',
    wait: '1 minute',
    leaves: 'a cut metadata read stops where it stood; the thread keeps its last published metadata and the next cadence reads again',
  },
  external: { named: "a terminal command or a file read of the CLI's storage", callsBack: false },
});

export class SessionMetadata extends Context.Service<
  SessionMetadata,
  {
    observed(threadId: string, facet: ExternalSession): Effect.Effect<void, StoreFailure | GateRefusal>;
    readerWords(threadId: string): Effect.Effect<readonly string[], StoreFailure | GateRefusal>;
  }
>()('tagma/external-harnesses/SessionMetadata') {}

export const makeSessionMetadata = Effect.fnUntraced(function* (
  adapters: HarnessAdapters['Service'],
  store: HarnessSessionStore,
  observations: HarnessObservations,
  terminals: Terminals['Service'],
  screens: TerminalScreens['Service'],
  records: ExecutionRecords['Service'],
  discharge: Discharge['Service'],
  access: Environments['Service'],
) {
  const jobs = new Map<string, Job>();
  const runtime = new MetadataBackend(access, terminals, screens, records, discharge, new MetadataIndex(METADATA_LIMITS));
  const scope = yield* Effect.scope;

  const observed = (threadId: string, facet: ExternalSession): Effect.Effect<void, StoreFailure | GateRefusal> => {
    const run = (job: Job) => watch(threadId, job);
    return store
      .binding(threadId)
      .pipe(
        Effect.flatMap((binding) =>
          jobsHeld.hold(
            'jobs',
            Effect.uninterruptible(
              Effect.gen(function* () {
                const prior = jobs.get(threadId);
                const terminal = binding?.adapter === 'terminal';
                const eligible =
                  harnessSessionActive(facet.session) &&
                  terminal &&
                  facet.session.state === 'running' &&
                  facet.execution !== null &&
                  lookupKey(facet) !== null;
                const key = eligible ? keyOf(facet) : null;
                const boundary = boundaryOf(facet);
                if (prior !== undefined && prior.key === key) {
                  if (prior.boundary !== boundary) {
                    prior.boundary = boundary;
                    yield* Queue.offer(prior.wake, undefined);
                  }
                  return null;
                }
                if (prior !== undefined) {
                  jobs.delete(threadId);
                  yield* Effect.withFiberSucceed((fiber) => prior.fiber?.interruptUnsafe(fiber.id));
                }
                if (key === null || adapters.find(facet.name)?.metadata === undefined) return prior?.fiber ?? null;
                const job: Job = { key, boundary, wake: yield* Queue.sliding<void>(1), fiber: null };
                jobs.set(threadId, job);
                job.fiber = yield* Effect.forkIn(
                  run(job)
                    .pipe(
                      Effect.ensuring(
                        Effect.sync(() => {
                          if (jobs.get(threadId) === job) jobs.delete(threadId);
                        }),
                      ),
                      Effect.onInterrupt(() => Effect.withSpan(Effect.void, 'HarnessMetadata.abort')),
                    )
                    .pipe(Effect.provideService(Holding, { tokens: [], tickets: [], within: [] })),
                  scope,
                  { startImmediately: false, uninterruptible: false },
                );
                return prior?.fiber ?? null;
              }),
            ),
          ),
        ),
        Effect.flatMap((retired) => (retired === null ? Effect.void : Fiber.interrupt(retired))),
      )
      .pipe(
        Effect.catchTags({
          HoldStalled: () =>
            Effect.fail(
              new GateRefusal('harness-jobs-busy', "the metadata job table was held too long to reconcile this thread's observation", [
                'the next observation of the thread reconciles it',
              ]),
            ),
          HoldCut: (cut) =>
            Effect.fail(
              new GateRefusal('harness-jobs-cut', `the metadata job table change ran past its ceiling: ${cut.leaves}`, [
                'the next observation of the thread reconciles it',
              ]),
            ),
        }),
      );
  };

  const watch = Effect.fnUntraced(
    function* (threadId: string, job: Job) {
      let readers: readonly MetadataRead[] | null = null;
      let published: string | null = null;
      while (true) {
        const facet = yield* store.read(threadId);
        const reader = facet === null ? undefined : adapters.find(facet.name)?.metadata;
        if (
          facet === null ||
          reader === undefined ||
          !harnessSessionActive(facet.session) ||
          keyOf(facet) !== job.key ||
          facet.execution === null ||
          lookupKey(facet) === null
        )
          return;
        const before = facet.observation;
        const fields: { -readonly [K in keyof HarnessFields]: HarnessFields[K] } = {
          model: { _tag: 'NotRead' },
          effort: { _tag: 'NotRead' },
          title: { _tag: 'NotRead' },
        };
        let failure: string | null = null;
        const input: MetadataInput | null = inputOf(facet);
        if (input === null) failure = 'launch-storage-unavailable';
        else if (input.storage.unreadable !== undefined) failure = input.storage.unreadable;
        else if (!/^[a-zA-Z0-9-]{1,200}$/.test(input.rootKey)) failure = 'session-identity-unreadable';
        else {
          if (readers === null) {
            const opened = yield* Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const scope = yield* Scope.make();
                const opened = yield* restore(
                  slotsHeld
                    .hold('slot', runtime.open(input, reader.sources(input)).pipe(Scope.provide(scope)))
                    .pipe(Effect.withSpan('HarnessMetadata.queue'), Effect.timeout(METADATA_CADENCE)),
                ).pipe(
                  Effect.onInterrupt(() => Scope.close(scope, Exit.void)),
                  Effect.result,
                );
                if (opened._tag === 'Failure') yield* Scope.close(scope, Exit.void);
                else yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
                return opened;
              }),
            );
            if (opened._tag === 'Failure') failure = 'execution-storage-unavailable';
            else readers = opened.success;
          }
          if (readers !== null) {
            const available = yield* Effect.result(slotsHeld.hold('slot', runtime.available(input))).pipe(
              Effect.timeoutOrElse({ duration: METADATA_CADENCE, orElse: () => Effect.succeed(null) }),
            );
            if (available === null) failure = 'execution-storage-timeout';
            else if (available._tag === 'Failure') failure = 'execution-storage-unreadable';
            else if (!available.success) failure = 'execution-storage-unavailable';
          }
          if (readers !== null && failure === null) {
            const reading = Effect.gen(function* () {
              let remaining = METADATA_PAGES;
              for (const read of readers!) {
                if (remaining === 0) break;
                let more: boolean;
                do {
                  const page = yield* slotsHeld
                    .hold('slot', Effect.suspend(read).pipe(Effect.withSpan('HarnessMetadata.job')))
                    .pipe(Effect.withSpan('HarnessMetadata.queue'));
                  remaining--;
                  Object.assign(fields, page.fields);
                  more = page.more;
                  if (more) yield* Effect.yieldNow;
                } while (more && remaining > 0);
              }
            });
            const completed = yield* reading.pipe(
              Effect.as(true),
              Effect.catchTags({ HoldStalled: () => Effect.succeed(false), HoldCut: () => Effect.succeed(false) }),
              Effect.timeoutOrElse({ duration: METADATA_CADENCE, orElse: () => Effect.succeed(false) }),
            );
            if (!completed) failure = 'metadata-read-timeout';
          }
        }
        if (failure !== null) {
          const declared = reader.provenance;
          const at = new Date(yield* Clock.currentTimeMillis).toISOString();
          for (const name of ['model', 'effort', 'title'] as const) {
            const field = declared[name];
            fields[name] =
              field === null
                ? { _tag: 'NotRead' }
                : !field.readable
                  ? { _tag: 'Unsupported', source: field.source, scope: { rootKey: lookupKey(facet), turnId: null }, observedAt: at }
                  : {
                      _tag: 'Unreadable',
                      source: field.source,
                      scope: { rootKey: lookupKey(facet), turnId: null },
                      observedAt: at,
                      reason: failure,
                      lastKnown: null,
                    };
          }
        }
        const fingerprint = JSON.stringify(fields, (key, value) => (key === 'observedAt' ? undefined : value));
        if (fingerprint !== published) {
          const receipt = yield* observations.metadata(threadId, { binding: before.binding, revision: before.revision, fields });
          if (receipt.outcome !== 'refused') published = fingerprint;
        }
        yield* Queue.take(job.wake);
      }
    },
    Effect.scoped,
    Effect.catch((failure) =>
      Effect.logWarning('metadata observation could not continue', {
        failure: failure instanceof Error ? failure.name : 'metadata-store-failure',
      }),
    ),
  );

  const readerWords = Effect.fn('HarnessMetadata.readerWords')(function* (threadId: string) {
    const facet = yield* store.read(threadId);
    const input = facet === null ? null : inputOf(facet);
    const adapter = facet === null ? null : adapters.find(facet.name);
    if (input === null || adapter === null) return [] as readonly string[];
    if (input.storage.unreadable !== undefined)
      return yield* new GateRefusal('metadata-unreadable', 'The session launch storage was truncated.', [
        'restore access to the session environment and retry',
      ]);
    return (yield* readHarnessTranscript(access, input, adapter)).words;
  });

  return SessionMetadata.of({ observed, readerWords });
});

const lookupKey = (facet: ExternalSession): string | null => facet.observation.binding.rootKey ?? facet.observation.binding.workKey ?? null;

export const inputOf = (facet: ExternalSession): MetadataInput | null => {
  const key = lookupKey(facet);
  const session = facet.session;
  if (key === null || session === undefined || session.storage === undefined || session.cwd === null || facet.execution === null)
    return null;
  return {
    rootKey: key,
    cwd: session.cwd,
    execution: facet.execution,
    storage: session.storage,
    transcriptPath: session.transcriptPath,
    exportPath: session.exportPath,
  };
};

const keyOf = (facet: ExternalSession): string =>
  JSON.stringify([
    facet.session?.id,
    facet.execution,
    facet.observation.binding.rootKey,
    facet.observation.binding.workKey ?? null,
    facet.session?.cwd,
    facet.session?.storage,
    facet.session?.transcriptPath,
    facet.session?.exportPath,
  ]);
const boundaryOf = (facet: ExternalSession): string => JSON.stringify([facet.turn?.run ?? null, facet.turn?.openedAt ?? null]);
