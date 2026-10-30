import { Context, Deferred, Effect, FiberMap, Layer } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { providerCatalogOf, staticRegistry } from '../../providers/testing/registry.js';
import { noInstalls } from '../../providers/testing/holders.js';
import { transcriptFiles } from './files.js';
import { Principal } from '@runlith/executions/protocol/custody';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { ExecutionProcessEvidence, ExecutionRecords } from '../../executions/contract/service/records.js';
import { TerminalRequests, Terminals } from '../../executions/contract/service/terminals.js';
import { byteOffset } from '@runlith/executions/protocol/record';
import { TerminalEndings as ExecutionEndings } from '../../executions/contract/service/endings.js';
import { Discharge } from '../../executions/contract/service/discharge.js';
import { HostManagement } from '../../executions/contract/service/host.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { ScratchAreas } from '../../threads/contract/service/scratch.js';
import { Settings } from '../../settings/contract/service/values.js';
import { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { Environments } from '../../workspace/contract/service/environments.js';
import { SessionObservations } from '../contract/service/observations.js';
import { SessionDriver } from '../sessions/drive.js';
import type { SessionAlignment } from '../sessions/alignment.js';
import type { HarnessSessionStore, SessionPublished } from '../store/sessions.js';
import { type ActivityLog, unrecorded } from '@runlith/activity/log';
import { standingAlignment } from './alignment.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { SessionPlace } from '../protocol/prompts.js';
import { HarnessLanes } from '../sessions/lanes.js';
import { TerminalEndings } from '../terminal/endings.js';
import { TerminalWords } from '../terminal/words.js';
import { TerminalInterrupts } from '../terminal/interrupts.js';
import { TerminalRuns } from '../terminal/runs.js';
import { ComposerDrafts } from '../terminal/drafts.js';
import { ThreadInbox } from '../../threads/store/inbox.js';
import { observationRebound } from '../observations/staleness.js';
import { hookReports } from './hookReports.js';
import { keyboardRecord, type KeyboardRig } from './keyboard.js';

export type KeyboardSessionInput = {
  readonly name: HarnessName;
  readonly keyboard: KeyboardRig;
  readonly accounts?: HarnessAccounts['Service'];
  readonly providers?: ProviderRegistry['Service'];
  readonly place?: SessionPlace;
  readonly alignment?: (store: HarnessSessionStore) => SessionAlignment;
  readonly start?: Terminals['Service']['start'];
  readonly request?: TerminalRequests['Service']['request'];
  readonly log?: ActivityLog;
  readonly published?: SessionPublished;
  readonly harnesses?: readonly HarnessProvider[];
};
const unused = () => Effect.die('An already seated keyboard session does not use that process boundary.');
const uncalled = (): never => {
  throw new Error('An already seated keyboard session reads no provider catalog.');
};

export const keyboardSession = Effect.fnUntraced(function* ({
  name,
  keyboard,
  accounts,
  providers,
  place,
  alignment,
  start,
  request,
  log,
  published,
  harnesses,
}: KeyboardSessionInput) {
  const memory = yield* transcriptFiles();
  const base = yield* hookReports({ name, key: 'root', access: memory.access, published, harnesses });
  const launched = new Map<string, ReturnType<typeof keyboardRecord>>();
  const record = keyboardRecord();
  const execution = { execution: record.execution.execution, incarnation: record.execution.incarnation };
  const ownerId = 'keyboard-owner';
  yield* base.store.change(base.id, (facet) =>
    Effect.succeed({
      facet: {
        ...facet,
        execution,
        observation: observationRebound(facet.observation, { sessionId: base.session, execution, rootKey: 'root' }),
        session: facet.session === undefined ? undefined : { ...facet.session, ownerId },
      },
      value: undefined,
    }),
  );
  const ownership: RunOwnership = {
    launchable: base.world.control.launchable,
    adopt: (candidate) =>
      Effect.map(base.world.lifecycle.adopt(candidate, { stage: 'running', message: 'Resumed' }), (result) =>
        'adopted' in result ? 'adopted' : result.refused,
      ),
    resumeParked: () => Effect.succeed({ runId: null, release: () => {} }),
    dropped: unused,
  };
  const endings = new TerminalEndings(base.store, base.journal, base.open, base.watch, ownership, base.closing);
  const words = new TerminalWords(base.store, base.journal);
  const lanes = new HarnessLanes(keyboard.grants, keyboard.writing);
  yield* lanes.open(base.session, record.projectId, record.execution, Principal.make('operator'));
  const fibers = yield* FiberMap.make<string, void, never>();
  const owners = yield* FiberMap.make<string, void, never>();
  const idle = yield* FiberMap.make<string, void, never>();
  let exited = yield* Deferred.make<void>();
  const ports = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(Terminals, {
        record: (id, incarnation) => (launched.has(id) ? Effect.succeed(launched.get(id)!) : keyboard.terminals.record(id, incarnation)),
        target: () =>
          Effect.succeed({
            projectId: 7,
            binding: memory.binding,
            footprint: {
              status: 'complete',
              resource: { namespaceId: memory.binding.namespaceId, path: '/project' },
              witness: memory.binding.identityWitness,
              registryRevision: 0,
              roots: [],
            },
          }),
        start:
          start ??
          Effect.fnUntraced(function* (request) {
            exited = yield* Deferred.make<void>();
            const next = { ...record, execution: { ...record.execution, execution: ExecutionId.make(crypto.randomUUID()) } };
            launched.set(next.execution.execution, next);
            return {
              _tag: 'Started' as const,
              operation: { installation: record.execution.installation, operation: request.operationId },
              record: next,
            };
          }),
        recordsOf: () =>
          Effect.map(keyboard.terminals.record(record.execution.execution, record.execution.incarnation), (held) =>
            held === null ? new Map() : new Map([[held.execution.execution, held]]),
          ),
        stop: (_project, key, execution, _expected, cause, requested) =>
          Effect.as(Deferred.succeed(exited, undefined), {
            execution,
            operation: { installation: execution.installation, operation: key.operationId },
            requested,
            cause,
            steps: [],
            cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'The scripted process has no accounting.' },
            coverage: [],
            relation: 'leader',
            confirmed: [],
            residual: [],
            unverifiable: [],
            streams: [],
            cleanup: 'complete',
            retention: 'retained',
            abandonedOutput: false,
          }),
        lost: () => Effect.succeed(null),
        state: (execution) =>
          Effect.succeed({
            state: {
              ref: execution,
              transport: 'pty',
              lifetime: 'held',
              purpose: 'command',
              phase: 'running',
              streams: { stdout: 'open', stderr: 'open', pty: 'open' },
              cleanup: 'pending',
              record: 'available',
            },
            custody: {
              revision: record.revision,
              holder: record.holder,
              origin: record.origin,
              target: { environment: 'memory', namespace: 'memory', cwd: '/project', dependencies: [] },
            },
            streams: [],
            native: {},
            input: { acceptedThrough: byteOffset(0n), pendingBytes: 0 },
          }),
      }),
      Layer.mock(ExecutionRecords, {}),
      Layer.mock(TerminalRequests, request === undefined ? {} : { request }),
      Layer.mock(ExecutionProcessEvidence, {}),
      Layer.mock(Discharge, {}),
      Layer.succeed(HostManagement, {
        standing: Effect.succeed({
          get boot() {
            return uncalled();
          },
          custodian: true,
          detail: 'scripted host',
          geometry: { rows: 24, columns: 80 },
          notice: null,
        }),
        get connection() {
          return uncalled();
        },
      }),
      Layer.mock(ScratchAreas, { root: '/scratch', directory: uncalled, scope: uncalled }),
      Layer.mock(Settings, { value: (key) => Effect.succeed(key.fallback) }),
      Layer.mock(GrantSigner, {
        grantFor: (id) => `grant:${id}`,
        threadOf: (grant) => (grant.startsWith('grant:') ? grant.slice(6) : null),
      }),
      accounts === undefined
        ? Layer.mock(HarnessAccounts, { launch: () => Effect.succeed(null) })
        : Layer.succeed(HarnessAccounts, accounts),
      Layer.succeed(ProviderRegistry, providers ?? staticRegistry(providerCatalogOf([]))),
      Layer.mock(ExecutionEndings, { decided: () => Effect.as(Deferred.await(exited), { _tag: 'Unwatchable' as const }) }),
    ),
  );
  const driver = new SessionDriver(
    base.store,
    Context.get(base.ports, ThreadRecords),
    Context.get(ports, Terminals),
    keyboard.screens,
    keyboard.writing,
    Context.get(ports, ExecutionRecords),
    Context.get(ports, TerminalRequests),
    Context.get(ports, ExecutionProcessEvidence),
    Context.get(ports, Discharge),
    Context.get(ports, HostManagement),
    place ?? (() => Effect.succeed({ projectId: 7, root: '/project' })),
    () => Effect.void,
    endings,
    words,
    Context.get(base.ports, SessionObservations),
    lanes,
    fibers,
    owners,
    idle,
    ownerId,
    Context.get(base.ports, Environments),
    Context.get(ports, ScratchAreas),
    Context.get(ports, Settings),
    Context.get(ports, GrantSigner),
    Context.get(ports, HarnessAccounts),
    Context.get(ports, ProviderRegistry),
    [],
    () => Effect.void,
    (alignment ?? standingAlignment)(base.store),
    yield* FiberMap.make<string, void, HarnessFailure>(),
    memory.files,
    Context.get(ports, ExecutionEndings),
    log ?? unrecorded,
    base.adapters,
    noInstalls,
  );
  const interrupts = new TerminalInterrupts(
    base.store,
    driver,
    base.watch,
    endings,
    yield* FiberMap.make<string, void, never>(),
    base.adapters,
  );
  const drafts = new ComposerDrafts(() => Effect.void);
  const runs = new TerminalRuns(
    base.store,
    driver,
    words,
    endings,
    interrupts,
    base.open,
    base.watch,
    ownership,
    Context.get(base.ports, ThreadInbox),
    base.journal,
    yield* FiberMap.make<string, void, never>(),
    drafts,
    base.adapters,
  );
  return { ...base, driver, interrupts, endings, words, runs, drafts, lanes, keyboard, execution };
});
