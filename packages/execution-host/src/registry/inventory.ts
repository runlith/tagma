import { createHash } from 'node:crypto';
import { Effect, Ref, Result, Context } from 'effect';
import { type CommandSnapshot, type CommandRevisionAnswer, type CommandRevisionRequest } from '@runlith/executions/protocol/command';
import {
  type CommandBatch,
  type CommandEntry,
  type CommandInventory,
  type CommandQuery,
  type InventoryChanges,
  type InventoryRevision,
  type UnmeasuredCoverage,
} from '@runlith/executions/protocol/inventory';
import { ExecutionId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { type ExecutionPage, type ExecutionSummary, type RuntimeStatus } from '@runlith/executions/protocol/runtime';
import { byteOffset, type StreamPositions } from '@runlith/executions/protocol/record';
import { RecordNameInvalid, recordFolder } from '@runlith/executions/recordFormat';
import { OUTPUT_FILE } from '../RecordWriter';
import { type AdmittedCommand } from '../store/records';
import { ExecutionUnreadable, ExecutionUnknown, ExecutionUnrecorded } from '../executionFailures';
import { type EndedExecution, type ObservedExecution } from '../ProcessEvidence';
import { type RegistryState, summaryOf, type HostClaim } from './state';
import { standingDeadline, reviseCommand } from './revisions';
import { filedEnding } from './endings';
import { type CustodianRefused } from '../Custodian';
import { type CustodyLost } from '../store/errors';
import { ForegroundRefusal, type ForegroundAnswer } from '@runlith/executions/protocol/terminal';

export const registryStatus = Effect.fnUntraced(function* (registry: RegistryState) {
  const { admission, custodian, capacity, watch, held, entered, shelf } = registry;
  const phase = yield* admission.phase();
  const loss = yield* Ref.get(registry.lost);
  const standing = yield* custodian.current();
  const executions = held.size;
  const ledger = yield* capacity.ledger();
  const counts = yield* capacity.counts();
  const rounds = watch === undefined ? undefined : yield* watch.status;
  const unadopted = yield* Ref.get(registry.unadopted);
  return {
    installation: entered.installation,
    incarnation: entered.incarnation,
    phase,
    holder: loss === undefined ? { _tag: 'Standing' } : { _tag: 'Lost', loss },
    custody: standing._tag === 'Settled' ? standing.custody : standing.last,
    executions,
    memory: {
      granted: ledger.granted,
      reserved: ledger.reserved,
      retained: ledger.retained,
      executions: ledger.executions,
      ceiling: Math.min(...capacity.profile.transports.map((transport) => counts.perTransport[transport])),
    },
    watch:
      rounds === undefined
        ? undefined
        : {
            rounds: rounds.rounds,
            delayed: rounds.delayed,
            skipped: rounds.skipped,
            failed: rounds.failed,
            lastRoundMs: rounds.lastRoundMs === undefined ? undefined : Math.round(rounds.lastRoundMs),
            longestRoundMs: Math.round(rounds.longestRoundMs),
          },
    kept: shelf.kept(),
    unadopted: unadopted.length === 0 ? undefined : unadopted,
  } satisfies RuntimeStatus;
});

const entryOf = Effect.fn('HostCommands.entryOf')(function* (
  registry: RegistryState,
  row: AdmittedCommand,
): Effect.fn.Return<CommandEntry | 'no-intent' | ExecutionUnreadable> {
  const { pacing, held, shelf } = registry;
  const record = row.record;
  const execution = record.state.ref.execution;
  const admission = record.command;
  if (admission === undefined) return 'no-intent';
  const found = held.get(execution);
  const kept = found === undefined ? shelf.get(execution) : undefined;
  const state = found === undefined ? (kept?.state ?? record.state) : yield* Ref.get(found.state);
  const read =
    kept?.deadline === undefined
      ? yield* Effect.result(standingDeadline(registry, record.state.ref, admission, found?.operation))
      : Result.succeed(kept.deadline);
  if (read._tag === 'Failure') return read.failure;
  const deadline = read.success;
  const measured =
    found !== undefined
      ? Result.succeed(yield* found.execution.stop.measured)
      : kept !== undefined
        ? Result.succeed(kept.receipt)
        : yield* Effect.result(filedEnding(registry, execution));
  if (measured._tag === 'Failure') {
    yield* Effect.logWarning(`the filed ending of ${execution} could not be read; its entry carries none`, measured.failure);
  }
  const ending = measured._tag === 'Success' ? measured.success : undefined;
  const processes = found === undefined ? kept?.processes : yield* found.execution.processes;
  const pace = found === undefined ? kept?.pace : pacing.paceOf(execution);
  const printed = found === undefined ? kept?.summary.printed : yield* found.execution.record.printed;
  return {
    admission,
    state,
    deadline,
    admittedAtMs: row.admittedAtMs,
    ending: ending,
    processes: processes,
    pace: pace,
    printed: printed,
  } satisfies CommandEntry;
});

const entriesOf = (
  registry: RegistryState,
  rows: ReadonlyArray<AdmittedCommand>,
): Effect.Effect<{
  readonly commands: ReadonlyArray<CommandEntry>;
  readonly intentless: number;
  readonly unreadable: number;
}> => {
  return Effect.map(
    Effect.forEach(rows, (row) => entryOf(registry, row)),
    (answered) => ({
      commands: answered.filter((entry): entry is CommandEntry => typeof entry !== 'string' && !(entry instanceof ExecutionUnreadable)),
      intentless: answered.filter((entry) => entry === 'no-intent').length,
      unreadable: answered.filter((entry) => entry instanceof ExecutionUnreadable).length,
    }),
  );
};

const gapsOf = (answered: { readonly intentless: number; readonly unreadable: number }): ReadonlyArray<UnmeasuredCoverage> => [
  ...(answered.intentless === 0
    ? []
    : [
        {
          region: `${answered.intentless} rows of this reading`,
          detail: 'the file holds them as commands and carries no admitted intent for them',
        },
      ]),
  ...(answered.unreadable === 0
    ? []
    : [
        {
          region: `${answered.unreadable} rows of this reading`,
          detail: 'the deadline that governs them could not be read, so no revision could be named for them',
        },
      ]),
];

const filterKey = (query: CommandQuery): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        query.scope ?? null,
        query.owner ?? null,
        query.cohort ?? null,
        query.phases === undefined ? null : [...query.phases].sort(),
      ]),
    )
    .digest('hex')
    .slice(0, 16);

const sealedPositions = Effect.fn('Executions.sealedPositions')(function* (registry: RegistryState, ref: ExecutionRef) {
  const read = yield* Effect.result(registry.shelf.positions(ref));
  if (read._tag === 'Success') return read.success;
  yield* Effect.logWarning(`the sealed record of ${ref.execution} could not be read; its state names no stream positions`, read.failure);
  return [];
});

const recordedSummary = Effect.fn('Executions.unacquiredSummary')(function* (registry: RegistryState, execution: ExecutionId) {
  const { store } = registry;
  const record = yield* store.executionOf(execution);
  if (record.state.phase !== 'ended') return undefined;
  const final = yield* store.finalOf(execution);
  if (final === undefined || (final.unacquired === undefined && record.state.record === 'unavailable')) return undefined;
  const operation = yield* store.startOf(execution);
  const streams =
    final.unacquired === undefined && record.state.record !== 'unavailable' ? yield* sealedPositions(registry, record.state.ref) : [];
  return {
    state: { ...record.state, unacquired: final.unacquired },
    custody: yield* store.custodyOf(execution),
    streams,
    native: record.native,
    input: final.unacquired === undefined ? undefined : { acceptedThrough: byteOffset(0n), pendingBytes: 0 },
    decision: operation === undefined ? undefined : yield* store.decisionOf(operation),
    outputFile: yield* keptOutput(registry, execution, streams),
  } satisfies ExecutionSummary;
});

const keptOutput = Effect.fn('Executions.keptOutput')(function* (
  registry: RegistryState,
  execution: ExecutionId,
  streams: ReadonlyArray<StreamPositions>,
) {
  const output = streams.find((positions) => positions.stream === 'output');
  const folder = recordFolder(execution);
  if (
    output === undefined ||
    output.ending !== 'eof' ||
    output.durableThrough === output.retainedFrom ||
    folder instanceof RecordNameInvalid
  ) {
    return undefined;
  }
  const file = registry.path.join(registry.records, folder, OUTPUT_FILE);
  const standing = yield* Effect.result(registry.fs.exists(file));
  if (standing._tag === 'Failure') {
    yield* Effect.logWarning(`the kept output of ${execution} could not be looked up`, standing.failure);
    return undefined;
  }
  return standing.success ? { path: file, from: output.retainedFrom, through: output.durableThrough } : undefined;
});

export const summary = Effect.fnUntraced(function* (registry: RegistryState, execution: ExecutionId) {
  const { held, shelf, queued } = registry;
  const found = held.get(execution);
  if (found !== undefined) return yield* summaryOf(registry, found);
  const kept = shelf.get(execution);
  if (kept !== undefined) return kept.summary;
  if ((yield* Ref.get(queued)).has(execution)) return undefined;
  return yield* recordedSummary(registry, execution).pipe(
    Effect.matchEffect({
      onFailure: (failure) =>
        failure._tag === 'StoredExecutionMissing'
          ? Effect.succeed(undefined)
          : Effect.as(Effect.logWarning(`the recorded state of ${execution} could not be read`, failure), undefined),
      onSuccess: Effect.succeed,
    }),
  );
});

const command = Effect.fn('HostCommands.command')(function* (registry: RegistryState, execution: ExecutionId) {
  const { store, held, shelf } = registry;
  const read = yield* Effect.result(store.executionOf(execution));
  if (read._tag === 'Failure') {
    if (read.failure._tag === 'StoredExecutionMissing') return undefined;
    return yield* new ExecutionUnreadable({ execution, reason: read.failure._tag });
  }
  const record = read.success;
  if (record.command === undefined) return undefined;
  const found = held.get(execution);
  const kept = found === undefined ? shelf.get(execution) : undefined;
  const state = found === undefined ? (kept?.state ?? record.state) : yield* Ref.get(found.state);
  return {
    admission: record.command,
    state,
    deadline: kept?.deadline ?? (yield* standingDeadline(registry, record.state.ref, record.command, found?.operation)),
  } satisfies CommandSnapshot;
});

const inventory = Effect.fn('HostCommands.inventory')(function* (registry: RegistryState, query: CommandQuery) {
  const { store, held } = registry;
  const filters = filterKey(query);
  if (query.after !== undefined && query.after.filters !== filters) {
    return {
      _tag: 'Refused',
      reason: 'filters-changed',
      detail: 'this continuation was produced under a different selection than the one it was handed back with',
    } satisfies CommandInventory;
  }
  const read = yield* Effect.result(store.commandPage(query));
  if (read._tag === 'Failure') {
    return {
      _tag: 'Refused',
      reason: 'unreadable',
      detail: `this host could not read its own command inventory: ${read.failure._tag}`,
    } satisfies CommandInventory;
  }
  const answered = yield* entriesOf(registry, read.success.rows);
  const last = read.success.rows[read.success.rows.length - 1];
  const status = yield* registryStatus(registry);
  return {
    _tag: 'Page',
    page: {
      commands: answered.commands,
      after:
        read.success.more && last !== undefined
          ? { admittedAtMs: last.admittedAtMs, execution: last.record.state.ref.execution, filters }
          : undefined,
      revision: held.revision,
      memory: status.memory,
      unmeasured: [
        {
          region: 'the live cost of these commands',
          detail: 'the registry answers what was admitted and what is running; usage is the sampler’s own reading',
        },
        ...gapsOf(answered),
      ],
    },
  } satisfies CommandInventory;
});

const commandsAt = Effect.fn('HostCommands.commandsAt')(function* (registry: RegistryState, refs: ReadonlyArray<ExecutionRef>) {
  const { store, held, entered } = registry;
  const mine = refs
    .filter((ref) => ref.installation === entered.installation && ref.incarnation === entered.incarnation)
    .map((ref) => ref.execution);
  const read = yield* Effect.result(store.commandsAt(mine));
  const revision = held.revision;
  if (read._tag === 'Failure') {
    return {
      commands: [],
      revision,
      unmeasured: [
        {
          region: `the ${mine.length} references this batch asked about`,
          detail: `this host could not read its own command inventory: ${read.failure._tag}`,
        },
      ],
    } satisfies CommandBatch;
  }
  const answered = yield* entriesOf(registry, read.success);
  return {
    commands: answered.commands,
    revision,
    unmeasured: [
      ...(mine.length === refs.length
        ? []
        : [
            {
              region: `${refs.length - mine.length} of the references asked about`,
              detail: `they name another installation or a generation this host has replaced; this host is ${entered.installation} at generation ${entered.incarnation}`,
            },
          ]),
      ...gapsOf(answered),
    ],
  } satisfies CommandBatch;
});

const watched = Effect.fnUntraced(function* (registry: RegistryState) {
  const { held, localScope } = registry;
  const executions = held.all();
  const observed = yield* Effect.forEach(executions, (found): Effect.Effect<ObservedExecution | undefined> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(found.state);
      if (state.phase === 'ended') return undefined;
      const native = yield* Ref.get(found.process);
      if (native.pid === undefined) return undefined;
      return {
        ref: found.ref,
        scope: localScope,
        members: found.native.proven === undefined ? [] : (yield* found.native.proven.members).map(({ pid, birth }) => ({ pid, birth })),
        leader: {
          pid: native.pid,
          birth: found.native.witness.birth,
          terminal: native.terminal,
        },
      };
    }),
  );
  return observed.filter((entry): entry is ObservedExecution => entry !== undefined);
});

const ended = Effect.fn('HostProcessFacts.ended')(function* (registry: RegistryState) {
  const reaped: EndedExecution[] = [];
  for (const found of registry.held.all()) {
    const state = yield* Ref.get(found.state);
    if (state.phase !== 'ended' || state.nativeExit === undefined) continue;
    const native = yield* Ref.get(found.process);
    if (native.pid === undefined) continue;
    const cost = yield* found.native.cost;
    if (cost._tag !== 'Measured') continue;
    reaped.push({ ref: found.ref, leader: { pid: native.pid, birth: found.native.witness.birth }, cpuMicros: cost.cpuMicros });
  }
  return reaped;
});

export const list = Effect.fnUntraced(function* (registry: RegistryState, after: ExecutionId | undefined, limit: number) {
  const { held } = registry;
  const page = held.page(after, limit);
  const rows = yield* Effect.forEach(page.rows, (found) => summaryOf(registry, found));
  const last = page.rows[page.rows.length - 1];
  return {
    executions: rows,
    after: page.more && last !== undefined ? last.ref : undefined,
  } satisfies ExecutionPage;
});

export const changes = Effect.fnUntraced(function* (registry: RegistryState, since: InventoryRevision, limit: number) {
  const { held } = registry;
  const read = held.changes(since, limit);
  if (read._tag === 'Reset') return read satisfies InventoryChanges;
  return {
    _tag: 'Changed',
    revision: read.revision,
    executions: yield* Effect.forEach(read.moved, (found) => summaryOf(registry, found)),
    left: read.left,
  } satisfies InventoryChanges;
});

const foreground = (registry: RegistryState, execution: ExecutionId): Effect.Effect<ForegroundAnswer> =>
  Effect.suspend(() => {
    const found = registry.held.get(execution);
    const channels = found?.native.held.channels;
    if (channels?._tag !== 'pty' || channels.terminal === undefined) {
      return Effect.succeed(ForegroundRefusal.make({ reason: 'no-terminal', detail: 'this execution holds no terminal' }));
    }
    return channels.terminal.foreground.pipe(
      Effect.match({
        onFailure: (refusal) => ForegroundRefusal.make({ reason: refusal.reason, detail: refusal.detail }),
        onSuccess: (process) => ({ _tag: 'Foreground' as const, process }),
      }),
    );
  });

const topology = Effect.fnUntraced(function* (registry: RegistryState, execution: ExecutionId) {
  const { held, localScope } = registry;
  const found = held.get(execution);
  if (found === undefined) return undefined;
  const native = yield* Ref.get(found.process);
  return {
    ref: found.ref,
    scope: localScope,
    leader:
      native.pid === undefined
        ? undefined
        : {
            pid: native.pid,
            birth: found.native.witness.birth,
            terminal: native.terminal,
          },
  } satisfies ObservedExecution;
});

export class HostCommands extends Context.Service<
  HostCommands,
  {
    readonly command: (execution: ExecutionId) => Effect.Effect<CommandSnapshot | undefined, ExecutionUnreadable>;
    readonly inventory: (query: CommandQuery) => Effect.Effect<CommandInventory>;
    readonly commandsAt: (refs: ReadonlyArray<ExecutionRef>) => Effect.Effect<CommandBatch>;
    readonly revise: (
      claim: HostClaim,
      request: CommandRevisionRequest,
    ) => Effect.Effect<
      CommandRevisionAnswer,
      ExecutionUnknown | ExecutionUnreadable | ExecutionUnrecorded | CustodianRefused | CustodyLost
    >;
  }
>()('@runlith/execution-host/HostCommands') {}

import type { ResidualProcess } from '../Residuals';

export class HostProcessFacts extends Context.Service<
  HostProcessFacts,
  {
    readonly watched: () => Effect.Effect<ReadonlyArray<ObservedExecution>>;
    readonly ended: () => Effect.Effect<ReadonlyArray<EndedExecution>>;
    readonly residuals: () => Effect.Effect<ReadonlyArray<ResidualProcess>>;
    readonly dropResiduals: (rows: ReadonlyArray<ResidualProcess>) => Effect.Effect<void>;
    readonly topology: (execution: ExecutionId) => Effect.Effect<ObservedExecution | undefined>;
    readonly foreground: (execution: ExecutionId) => Effect.Effect<ForegroundAnswer>;
  }
>()('@runlith/execution-host/HostProcessFacts') {}

export const hostCommandsOf = (registry: RegistryState) =>
  HostCommands.of({
    command: (execution) => command(registry, execution),
    inventory: (query) => inventory(registry, query),
    commandsAt: (refs) => commandsAt(registry, refs),
    revise: (claim, request) => reviseCommand(registry, claim, request),
  });

export const hostProcessFactsOf = (registry: RegistryState) =>
  HostProcessFacts.of({
    watched: () => watched(registry),
    ended: () => ended(registry),
    residuals: () => registry.residuals.all,
    dropResiduals: (rows) => registry.residuals.drop(rows),
    topology: (execution) => topology(registry, execution),
    foreground: (execution) => foreground(registry, execution),
  });
