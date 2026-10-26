import { Effect } from 'effect';
import { HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { CommandSubject } from '../contract/wire/commandSubject.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import { principalOf } from './principals.js';
import { type TerminalActor, type TerminalRecord } from '../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { RootUse } from '../../workspace/contract/wire/uses.js';
import type { EndedExecution } from '../contract/wire/rootExecutions.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import type { RootEnding, RootExecution, Unreachable } from '../contract/service/rootExecutions.js';
import type { CommandAccess, CommandAccessRequest, StopPreparation, TerminalAccess } from '../contract/service/access.js';
import type { CommandAuthority } from '../contract/service/commands.js';
import type { TerminalDischarge } from '../contract/service/discharge.js';

export type StopKeyState = 'free' | 'sent' | 'unsent';

export type RootExecutionRoads = {
  readonly holding: (
    projectId: number,
    useIds: readonly string[],
  ) => Effect.Effect<{ readonly terminals: readonly TerminalRecord[]; readonly commands: readonly CommandRecord[] }, unknown>;
  readonly access: Pick<TerminalAccess['Service'], 'prepare'>;
  readonly commands: {
    readonly prepare: (request: CommandAccessRequest) => ReturnType<CommandAccess['Service']['prepare']>;
    readonly recheck: CommandAccess['Service']['recheck'];
  };
  readonly ended: (projectId: number, execution: ExecutionRef) => Effect.Effect<TerminalDischarge, unknown>;
  readonly key: (projectId: number, operationId: HostRequestKey) => Effect.Effect<StopKeyState, unknown>;
  readonly stop: (key: TerminalOperationKey, record: TerminalRecord) => Effect.Effect<unknown, unknown>;
  readonly stopCommand: (
    key: TerminalOperationKey,
    record: CommandRecord,
    authority: CommandAuthority<StopPreparation>,
  ) => Effect.Effect<unknown, unknown>;
  readonly now?: () => number;
};

const describe = (cause: unknown): string =>
  typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string' ? cause.message : String(cause);

const unreadable = (cause: unknown) =>
  new TerminalUnavailable({ owner: 'store', message: `what holds this root could not be read: ${describe(cause)}` });

const holderOf = (owner: CommandSubject): string =>
  owner._tag === 'Thread' ? `thread:${owner.thread}` : owner._tag === 'Service' ? `service:${owner.scope}` : 'operator';

const unknown = (use: RootUse): RootExecution => ({
  use,
  shown: null,
  unreachable: 'unknown',
  end: () => Effect.fail({ message: 'nothing this act can stop holds this use' }),
  discharged: Effect.succeed(false),
});

const judged = (placed: RootId | undefined, rootId: RootId, reached: boolean): Unreachable | null =>
  placed !== rootId ? 'started-elsewhere' : reached ? null : 'stop-refused';

export const rootExecutions = (deps: RootExecutionRoads): RootEnding =>
  Effect.fnUntraced(function* (projectId, rootId, requester, uses) {
    const held = yield* Effect.mapError(
      deps.holding(
        projectId,
        uses.map((use) => use.useId),
      ),
      unreadable,
    );
    const standing: RootExecution[] = [];
    for (const use of uses) {
      const terminal =
        use.consumer.kind === 'terminal' ? held.terminals.find((record) => record.holdings.rootUse === use.useId) : undefined;
      const command = use.consumer.kind === 'command' ? held.commands.find((record) => record.holdings.rootUse === use.useId) : undefined;
      if (terminal !== undefined) standing.push(yield* terminalOf(deps, projectId, rootId, requester, use, terminal));
      else if (command !== undefined) standing.push(yield* commandOf(deps, projectId, rootId, requester, use, command));
      else standing.push(unknown(use));
    }
    return standing;
  });

const discharged = (
  deps: RootExecutionRoads,
  projectId: number,
  execution: ExecutionRef,
): Effect.Effect<boolean, { readonly message: string }> =>
  deps.ended(projectId, execution).pipe(
    Effect.map((proof) => proof._tag === 'Discharged'),
    Effect.mapError((cause) => ({ message: describe(cause) })),
  );

const stopping = Effect.fnUntraced(
  function* (
    deps: RootExecutionRoads,
    projectId: number,
    execution: ExecutionRef,
    operationId: string,
    send: (key: HostRequestKey) => Effect.Effect<unknown, unknown>,
  ) {
    if (yield* discharged(deps, projectId, execution)) return false;
    const key = HostRequestKey.make(operationId);
    const state = yield* deps.key(projectId, key);
    if (state === 'sent') return true;
    yield* send(state === 'free' ? key : HostRequestKey.make(`${operationId}:${(deps.now ?? Date.now)()}`));
    return true;
  },
  Effect.mapError((failure): { readonly message: string } => ({ message: describe(failure) })),
);

const terminalOf = Effect.fnUntraced(function* (
  deps: RootExecutionRoads,
  projectId: number,
  rootId: RootId,
  requester: TerminalActor,
  use: RootUse,
  record: TerminalRecord,
): Effect.fn.Return<RootExecution, TerminalUnavailable> {
  const verdict = yield* Effect.result(
    deps.access.prepare({
      actor: requester,
      place: { _tag: 'Keyed', projectId: record.projectId, targetKey: record.targetKey },
      owner: record.holder,
      standing: { projectId: record.projectId, holder: record.holder },
      act: { _tag: 'Stop' },
      subject: { _tag: 'Stop', execution: record.execution, revision: record.revision },
    }),
  );
  if (verdict._tag === 'Failure' && verdict.failure._tag === 'TerminalUnavailable') return yield* unreadable(verdict.failure);
  return {
    use,
    shown: { kind: 'terminal', execution: record.execution, program: record.program ?? null, holder: record.holder },
    unreachable: judged(record.rootId, rootId, verdict._tag === 'Success'),
    discharged: discharged(deps, projectId, record.execution),
    end: (operationId) =>
      stopping(deps, projectId, record.execution, operationId, (key) =>
        deps.stop(
          {
            projectId,
            operationId: key,
            requester: principalOf(requester),
            mutation: 'stop',
            targetKey: record.targetKey,
            execution: record.execution,
          },
          record,
        ),
      ),
  };
});

const commandOf = Effect.fnUntraced(function* (
  deps: RootExecutionRoads,
  projectId: number,
  rootId: RootId,
  requester: TerminalActor,
  use: RootUse,
  record: CommandRecord,
): Effect.fn.Return<RootExecution, TerminalUnavailable> {
  const holder = holderOf(record.owner);
  const shown: EndedExecution = { kind: 'command', execution: record.execution, program: record.program ?? null, holder };
  const verdict = yield* Effect.result(
    deps.commands.prepare({ _tag: 'Stop', actor: requester, scope: projectId, execution: record.execution }),
  );
  if (verdict._tag === 'Failure' && verdict.failure._tag !== 'TerminalRefused') {
    return yield* unreadable(verdict.failure);
  }
  const prepared = verdict._tag === 'Failure' ? null : verdict.success;
  const request = prepared?.request;
  const authority: CommandAuthority<StopPreparation> | null =
    prepared === null || request === undefined || request._tag !== 'Stop'
      ? null
      : { prepared: { ...prepared, request }, recheck: (unit) => deps.commands.recheck(unit, prepared) };
  return {
    use,
    shown,
    unreachable: judged(record.rootId, rootId, authority !== null),
    discharged: discharged(deps, projectId, record.execution),
    end: (operationId) =>
      authority === null
        ? Effect.fail({ message: 'this requester may not stop this command' })
        : stopping(deps, projectId, record.execution, operationId, (key) =>
            deps.stopCommand(
              {
                projectId,
                operationId: key,
                requester: principalOf(requester),
                mutation: 'stop',
                targetKey: authority.prepared.targetKey,
                execution: record.execution,
              },
              record,
              authority,
            ),
          ),
  };
});
