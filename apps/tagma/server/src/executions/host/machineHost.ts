import { Effect, FileSystem, Option } from 'effect';
import { bootPath } from '@runlith/executions/protocol/boot';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionPage, ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { MachineHost } from '../../installation/contract/service/machineHost.js';
import type { MachineState, RunningExecution } from '../../installation/contract/wire/machine.js';
import type { HostManagement } from '../contract/service/host.js';
import type { Terminals } from '../contract/service/terminals.js';
import { HostRegistration } from '@runlith/executions/HostRegistration';

const LISTING_PAGES = 200;

const TITLE_WIDTH = 72;

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

export const makeMachineHost = Effect.fnUntraced(function* ({
  host,
  terminals,
}: {
  readonly host: HostManagement['Service'];
  readonly terminals: Terminals['Service'];
}) {
  const registrations = yield* HostRegistration;
  const files = yield* FileSystem.FileSystem;
  return MachineHost.of({ standing: standingOf(host, terminals, registrations, files) });
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
