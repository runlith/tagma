import { Effect, FileSystem, Option, Stream } from 'effect';
import { bootPath } from '@runlith/executions/protocol/boot';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionPage, ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { MachineHost } from '../../installation/contract/service/machineHost.js';
import type { MachineState, RunningExecution } from '../../installation/contract/wire/machine.js';
import type { HostEnding } from '../../installation/contract/wire/newHost.js';
import type { HostManagement, HostStanding } from '../contract/service/host.js';
import type { ExecutionProcessEvidence } from '../contract/service/records.js';
import type { Terminals } from '../contract/service/terminals.js';
import { type CommandRecord, commandLineOf } from '../contract/wire/commands.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';
import { HostRegistration } from '@runlith/executions/HostRegistration';

const LISTING_PAGES = 200;

const TITLE_WIDTH = 72;

const EVIDENCE_AT_ONCE = 4;

const presenceOf = (failure: ExecutionsFailure): 'unspoken' | 'absent' =>
  failure._tag === 'WireInvalid' ||
  failure._tag === 'WireUnreadable' ||
  (failure._tag === 'WireFailed' &&
    (failure.fault.kind === 'malformed' || failure.fault.kind === 'unsupported-version' || failure.fault.kind === 'unsupported-family'))
    ? 'unspoken'
    : 'absent';

const runningOf = Effect.fnUntraced(function* (host: HostManagement['Service']) {
  const held: ExecutionSummary[] = [];
  let after: ExecutionRef | undefined = undefined;
  for (let page = 0; page < LISTING_PAGES; page += 1) {
    const asked: Effect.Effect<ExecutionPage, ExecutionsFailure> = host.connection.direct.list(after === undefined ? undefined : { after });
    const listed = yield* Effect.result(asked);
    if (listed._tag === 'Failure') {
      yield* Effect.logDebug('the executions the host holds could not be listed; its holdings are unmeasured', {
        reason: listed.failure._tag,
      });
      return null;
    }
    held.push(...listed.success.executions);
    after = listed.success.after;
    if (after === undefined || listed.success.executions.length === 0) break;
  }
  return held;
});

const titled = (line: string): string => {
  const first = line.split('\n')[0] ?? '';
  return first.length > TITLE_WIDTH ? `${first.slice(0, TITLE_WIDTH - 1)}…` : first;
};

const namedOf = (terminals: Terminals['Service'], summaries: ReadonlyArray<ExecutionSummary>) =>
  Effect.map(terminals.recordsOf(summaries.map((summary) => summary.state.ref)), (records) =>
    summaries.map((summary): RunningExecution => {
      const ref = summary.state.ref;
      const record = records.get(ref.execution) ?? null;
      const title = titled(
        record?.label ?? record?.commandLine ?? record?.program ?? `${summary.state.purpose} ${ref.execution.slice(0, 8)}`,
      );
      return {
        execution: ref.execution,
        incarnation: ref.incarnation,
        title,
        kind: summary.state.transport === 'pty' ? 'terminal' : 'command',
        holder: summary.custody.holder,
        since: record === null ? null : new Date(record.acceptedAt).toISOString(),
      };
    }),
  );

const sinceOf = Effect.fnUntraced(function* (files: FileSystem.FileSystem, boot: string) {
  const read = yield* Effect.result(files.stat(boot));
  if (read._tag === 'Success') return Option.getOrNull(Option.map(read.success.mtime, (at) => at.toISOString()));
  yield* Effect.logDebug('the boot input of the host could not be read; when it came up is unmeasured', {
    reason: read.failure.reason._tag,
  });
  return null;
});

export type StandingRows = Effect.Effect<{
  readonly terminals: ReadonlyArray<TerminalRecord>;
  readonly commands: ReadonlyArray<CommandRecord>;
} | null>;

export const makeMachineHost = Effect.fnUntraced(function* ({
  host,
  standings,
  terminals,
  evidence,
  rows,
}: {
  readonly host: HostManagement['Service'];
  readonly standings: Stream.Stream<HostStanding>;
  readonly terminals: Terminals['Service'];
  readonly evidence: ExecutionProcessEvidence['Service'];
  readonly rows: StandingRows;
}) {
  const registrations = yield* HostRegistration;
  const files = yield* FileSystem.FileSystem;
  const stays = Effect.map(host.standing, (standing) => standing.stays ?? null);
  return MachineHost.of({
    standing: standingOf(host, terminals, registrations, files),
    build: Effect.matchEffect(registrations.read(host.connection.address.state), {
      onFailure: (failure) =>
        Effect.as(Effect.logDebug('the host registration could not be read; its build is unmeasured', { reason: failure._tag }), null),
      onSuccess: (registration) => Effect.succeed(registration.artifact?.identity.build ?? null),
    }).pipe(Effect.withSpan('MachineHost.build')),
    stays,
    staying: Stream.changes(Stream.map(standings, (standing) => standing.stays ?? null)),
    endings: Effect.flatMap(stays, (stayed) =>
      stayed === null ? endingsOf(host, evidence, rows) : Effect.map(rows, (read) => (read === null ? null : unreadEndings(read))),
    ).pipe(Effect.withSpan('MachineHost.endings')),
  });
});

const titleOf = (record: { readonly label?: string; readonly commandLine?: string; readonly program?: string }, fallback: string) =>
  record.label ?? record.commandLine ?? record.program ?? fallback;

const unreadEndings = ({ terminals, commands }: NonNullable<Effect.Success<StandingRows>>): ReadonlyArray<HostEnding> => [
  ...terminals.map((record): HostEnding => ({
    execution: record.execution.execution,
    incarnation: record.execution.incarnation,
    activity: 'unread',
    title: titleOf(record, 'terminal'),
    projectId: record.projectId,
    thread: record.heldBy ?? record.launchedFor ?? null,
  })),
  ...commands.map((record): HostEnding => ({
    execution: record.execution.execution,
    incarnation: record.execution.incarnation,
    activity: 'command',
    title: titleOf(record, 'command'),
    projectId: record.projectId,
    thread: record.owner._tag === 'Thread' ? record.owner.thread : null,
  })),
];

const startedAsShell = (record: TerminalRecord): boolean =>
  record.program !== undefined && record.commandLine === commandLineOf(record.program, ['-l']);

const terminalEnding = Effect.fnUntraced(function* (
  evidence: ExecutionProcessEvidence['Service'],
  summary: ExecutionSummary,
  record: TerminalRecord,
): Effect.fn.Return<HostEnding> {
  const ref = summary.state.ref;
  const base = {
    execution: ref.execution,
    incarnation: ref.incarnation,
    title: titleOf(record, 'terminal'),
    projectId: record.projectId,
    thread: record.heldBy ?? record.launchedFor ?? null,
  };
  const read = yield* Effect.result(evidence.foreground(ref));
  if (read._tag === 'Failure') {
    yield* Effect.logDebug('the foreground of a terminal could not be read; what a new host ends names it unread', {
      reason: read.failure._tag,
    });
    return { ...base, activity: 'unread' };
  }
  if (read.success._tag !== 'Foreground') return { ...base, activity: 'unread' };
  const front = read.success.process;
  if (front.pid === summary.native.pid) return { ...base, activity: startedAsShell(record) ? 'shell' : 'program' };
  const processes = yield* Effect.result(evidence.processes(ref));
  if (processes._tag === 'Failure') {
    yield* Effect.logDebug('the processes of a terminal could not be read; what a new host ends keeps its own title', {
      reason: processes.failure._tag,
    });
    return { ...base, activity: 'program' };
  }
  const named = processes.success?.processes.find((one) => one.identity.pid === front.pid)?.command;
  return { ...base, activity: 'program', title: named === undefined || named.trim() === '' ? base.title : named };
});

const endingOf = (
  evidence: ExecutionProcessEvidence['Service'],
  summary: ExecutionSummary,
  terminal: TerminalRecord | undefined,
  command: CommandRecord | undefined,
): Effect.Effect<HostEnding> => {
  const ref = summary.state.ref;
  if (command !== undefined) {
    return Effect.succeed({
      execution: ref.execution,
      incarnation: ref.incarnation,
      activity: 'command',
      title: titleOf(command, 'command'),
      projectId: command.projectId,
      thread: command.owner._tag === 'Thread' ? command.owner.thread : null,
    });
  }
  if (terminal === undefined) {
    return Effect.succeed({
      execution: ref.execution,
      incarnation: ref.incarnation,
      activity: summary.state.transport === 'pty' ? 'unread' : 'command',
      title: `${summary.state.purpose} ${ref.execution.slice(0, 8)}`,
      projectId: null,
      thread: null,
    });
  }
  if (summary.state.transport === 'pty') return terminalEnding(evidence, summary, terminal);
  return Effect.succeed({
    execution: ref.execution,
    incarnation: ref.incarnation,
    activity: 'program',
    title: titleOf(terminal, 'terminal'),
    projectId: terminal.projectId,
    thread: terminal.heldBy ?? terminal.launchedFor ?? null,
  });
};

const endingsOf = Effect.fnUntraced(function* (
  host: HostManagement['Service'],
  evidence: ExecutionProcessEvidence['Service'],
  rows: StandingRows,
): Effect.fn.Return<ReadonlyArray<HostEnding> | null> {
  const listed = yield* runningOf(host);
  if (listed === null) return null;
  const read = yield* rows;
  if (read === null) return null;
  const terminals = new Map(read.terminals.map((record) => [record.execution.execution, record]));
  const commands = new Map(read.commands.map((record) => [record.execution.execution, record]));
  return yield* Effect.forEach(
    listed.filter((summary) => summary.state.phase !== 'ended'),
    (summary) => endingOf(evidence, summary, terminals.get(summary.state.ref.execution), commands.get(summary.state.ref.execution)),
    { concurrency: EVIDENCE_AT_ONCE },
  );
});

const standingOf = Effect.fnUntraced(function* (
  host: HostManagement['Service'],
  terminals: Terminals['Service'],
  registrations: HostRegistration['Service'],
  files: FileSystem.FileSystem,
): Effect.fn.Return<MachineState['host']> {
  const registered = yield* Effect.result(registrations.read(host.connection.address.state));
  if (registered._tag === 'Failure') {
    return {
      presence: registered.failure._tag === 'RegistrationMissing' ? 'absent' : 'unspoken',
      detail: `The host registration could not be read (${registered.failure._tag}); its build and holdings are unmeasured.`,
      incarnation: null,
      build: null,
      since: null,
      custody: 'unknown',
      holds: null,
      memory: null,
    };
  }
  const build = registered.success.artifact?.identity.build ?? null;
  const digest = registered.success.artifact?.identity.digest;
  const since = digest === undefined ? null : yield* sinceOf(files, bootPath(host.connection.address.state, digest));
  const status = yield* Effect.result(host.connection.direct.status());
  const { detail, custodian } = yield* host.standing;
  if (status._tag === 'Failure') {
    return {
      presence: presenceOf(status.failure),
      detail,
      incarnation: null,
      build,
      since,
      custody: 'unknown' as const,
      holds: null,
      memory: null,
    };
  }
  const live = status.success;
  const listed = yield* runningOf(host);
  const running = listed === null ? null : listed.filter((summary) => summary.state.phase !== 'ended');
  const read = running === null ? null : yield* Effect.result(namedOf(terminals, running));
  if (read !== null && read._tag === 'Failure') {
    yield* Effect.logDebug('the terminals the host runs could not be named; its holdings are unmeasured', { reason: read.failure._tag });
  }
  const named = read === null || read._tag === 'Failure' ? null : read.success;
  return {
    presence: 'answering' as const,
    detail,
    incarnation: live.incarnation,
    build,
    since,
    custody: live.custody.holder === undefined ? ('vacant' as const) : custodian ? ('ours' as const) : ('other' as const),
    holds:
      named === null || listed === null
        ? null
        : {
            running: named,
            terminals: named.filter((row) => row.kind === 'terminal').length,
            commands: named.filter((row) => row.kind === 'command').length,
            records: listed.length - named.length,
          },
    memory: { reserved: live.memory.reserved, retained: live.memory.retained, grant: live.memory.granted.grantBytes },
  };
});
