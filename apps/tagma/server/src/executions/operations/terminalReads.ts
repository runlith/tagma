import { Effect, Schema } from 'effect';
import { said, saidLines } from '../../platform/contract/service/presentation.js';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { pageRows } from '@runlith/paging';
import { HostRefused } from '@runlith/executions/Executions';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CustodyTransfer } from '@runlith/executions/protocol/control';
import type { InputInstruction } from '@runlith/executions/protocol/input';
import { GateRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { mintShellKey } from '../../platform/credentials/grants.js';
import { pair, type InputOf } from '../../platform/contract/service/body.js';
import { executionActorOf } from '../terminals/principals.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { TERMINAL_OPERATIONS, TERMINALS } from '../contract/wire/operations/terminalCatalog.js';
import { readingVoice, terminalsText, terminalWaitVoice } from '../voice/terminals.js';
import { screenVoice } from '../voice/screen.js';
import { windowVoice } from '../voice/byteWindow.js';
import { operationVoice } from '../voice/operation.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { principalOf } from '../terminals/principals.js';
import {
  terminalView,
  type InteractiveGrant,
  type TerminalActor,
  type TerminalRow,
  type TerminalRecord,
} from '../contract/wire/terminals.js';
import type { ResolvedExecutionTarget, TargetKey } from '../contract/wire/targets.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { TerminalAdopters } from '../contract/service/adopters.js';
import { TerminalAccess, type TerminalActRequest } from '../contract/service/access.js';
import { ActingRun } from '../contract/service/grants.js';
import { TerminalTargets } from '../contract/service/targets.js';
import { Custody } from '../contract/service/custody.js';
import { ExecutionHost, HostManagement } from '../contract/service/host.js';
import { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from '../contract/service/records.js';
import { TerminalRequests, Terminals, type TerminalFailure } from '../contract/service/terminals.js';
import { TerminalWriting } from '../contract/service/writing.js';
import { requestedEnvironment } from '../terminals/environment.js';
import { TERMINAL_PERMISSION_REVISION, type TerminalPlace } from '../contract/service/subjectPolicy.js';
import { targetIdentity, targetKeyOf } from '../terminals/subjectPolicy.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { withAdopters } from '../terminals/adopted.js';
import { terminalBody } from './projection.js';

type TerminalRequirements =
  | Terminals
  | TerminalRequests
  | TerminalWriting
  | Custody
  | ExecutionRecords
  | TerminalScreens
  | ExecutionProcessEvidence
  | ExecutionHost
  | HostManagement
  | TerminalAccess
  | TerminalTargets
  | ActingRun
  | CurrentProject;

export const unknownExecution = (execution: string, incarnation: number): GateRefusal<'terminal-unknown'> =>
  new GateRefusal(
    'terminal-unknown',
    `this installation holds no projection of execution ${execution} at incarnation ${incarnation} in this project`,
    [
      'read this project’s terminal inventory',
      'name the incarnation the execution was answered at: a replacement host restarts them, and an old one addresses nothing',
    ],
  );

export const actorOf = Effect.fn('terminals.actor')(function* (caller: Caller) {
  const call = yield* yield* CurrentProject;
  const actor = executionActorOf(caller.actor, call.project.id);
  return actor instanceof TerminalRefused ? yield* actor : actor;
});

export const projected = Effect.fn('terminals.projected')(function* (caller: Caller, execution: string, incarnation: number) {
  const call = yield* yield* CurrentProject;
  const record = yield* (yield* Terminals).record(execution, incarnation);
  if (record === null || record.projectId !== call.project.id) {
    return yield* unknownExecution(execution, incarnation);
  }
  return record;
});

const typedBy = Effect.fn('terminals.typedBy')(function* (caller: Caller, record: TerminalRecord) {
  const actor = executionActorOf(caller.actor, record.projectId);
  const reader = actor instanceof TerminalRefused ? null : principalOf(actor);
  const others = yield* (yield* TerminalWriting).typedBy(record.execution, reader);
  return others.length === 0 ? {} : { typedBy: others.map(({ writer, at }) => ({ writer, at: new Date(at).toISOString() })) };
});

const terminalKey = (listing: TerminalRow): readonly [number, string] => [listing.record.acceptedAt, listing.record.execution.execution];

const TERMINALS_WALK = {
  operation: 'read_terminals',
  order: TERMINALS.order,
  selection: Schema.Struct({
    projectId: Schema.Number,
    standing: Schema.optional(Schema.Boolean),
    holder: Schema.optional(Schema.String),
    execution: Schema.optional(Schema.String),
  }),
  key: Schema.Tuple([Schema.Number, Schema.String]),
};

export const TERMINAL_READ_PAIRS = {
  read_terminals: pair(
    TERMINAL_OPERATIONS.read_terminals,
    terminalBody(TERMINAL_OPERATIONS.read_terminals, {
      execute: Effect.fnUntraced(function* (input: InputOf<typeof TERMINAL_OPERATIONS.read_terminals>, _prepared: undefined) {
        const call = yield* yield* CurrentProject;
        const narrowed = input.cursor === undefined ? undefined : yield* walks.recall(TERMINALS_WALK, input.cursor);
        const standing = input.standing ?? narrowed?.standing;
        const holder = input.holder ?? narrowed?.holder;
        const execution = input.execution ?? narrowed?.execution;
        const terminals = yield* Terminals;
        const cut = yield* walks.page({
          walk: TERMINALS_WALK,
          selection: { projectId: call.project.id, standing, holder, execution },
          cursor: input.cursor,
          asked: pageRows(input.limit, TERMINALS, ceilingOf(TERMINALS)),
          keyOf: terminalKey,
          read: (after, rows) =>
            Effect.map(
              terminals.inventory(call.project.id, {
                standing,
                holder: holder === undefined ? undefined : Principal.make(holder),
                limit: rows,
                execution,
                after: after === undefined ? undefined : { acceptedAt: after[0], execution: after[1] },
              }),
              (listed) => ({ rows: listed.terminals, total: listed.total }),
            ),
        });
        const adopted = yield* withAdopters(yield* TerminalAdopters, call.project.id, cut.rows);
        const host = yield* (yield* ExecutionHost).ledger();
        const { notice, geometry } = yield* (yield* HostManagement).standing;
        return {
          terminals: adopted,
          shown: cut.shown,
          total: cut.total,
          next: cut.next,
          complete: cut.complete,
          host: host ?? null,
          operationKeys: yield* (yield* TerminalRequests).retention(),
          grants: (yield* TerminalWriting).grantCounts(),
          notice,
          geometry,
        };
      }),
      voice: said(terminalsText),
    }),
  ),

  read_terminal: pair(
    TERMINAL_OPERATIONS.read_terminal,
    terminalBody(TERMINAL_OPERATIONS.read_terminal, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.read_terminal>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const record = yield* projected(caller, input.execution, input.incarnation);
        const terminals = yield* Terminals;
        const state = yield* terminals.state(record.execution);
        const lost = state === undefined ? yield* terminals.lost(record) : null;
        const adoptedBy = (yield* (yield* TerminalAdopters).of(record.projectId, [record.execution.execution])).get(
          record.execution.execution,
        );
        return {
          terminal: adoptedBy === undefined ? terminalView(record) : { ...terminalView(record), adoptedBy: ThreadId.make(adoptedBy) },
          state: state === undefined ? lost : state.state,
          endedWithHost: state === undefined && lost !== null,
          grid: state?.grid ?? null,
          lanes: (yield* TerminalWriting).lanesOver(record.projectId, record.execution),
          ...(yield* typedBy(caller, record)),
        };
      }),
      voice: saidLines(readingVoice),
    }),
  ),

  read_terminal_operation: pair(
    TERMINAL_OPERATIONS.read_terminal_operation,
    terminalBody(TERMINAL_OPERATIONS.read_terminal_operation, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.read_terminal_operation>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const call = yield* yield* CurrentProject;
        const answer = yield* (yield* TerminalRequests).requestFor(
          yield* actorOf(caller),
          call.project.id,
          HostRequestKey.make(input.operationId),
        );
        return { operation: answer };
      }),
      voice: saidLines(operationVoice),
    }),
  ),

  read_terminal_screen: pair(
    TERMINAL_OPERATIONS.read_terminal_screen,
    terminalBody(TERMINAL_OPERATIONS.read_terminal_screen, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.read_terminal_screen>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const record = yield* projected(caller, input.execution, input.incarnation);
        return {
          screen: yield* (yield* TerminalScreens).screen(record.execution, { cells: input.cells === true }),
          ...(yield* typedBy(caller, record)),
        };
      }),
      voice: saidLines(screenVoice),
    }),
  ),

  read_terminal_bytes: pair(
    TERMINAL_OPERATIONS.read_terminal_bytes,
    terminalBody(TERMINAL_OPERATIONS.read_terminal_bytes, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.read_terminal_bytes>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const record = yield* projected(caller, input.execution, input.incarnation);
        const chunk = yield* (yield* ExecutionRecords).bytes(
          { ref: record.execution, stream: input.stream, offset: input.offset },
          input.limit ?? 65_536,
          { withPositions: input.positions !== false },
        );
        return {
          range: chunk.range,
          positions: chunk.positions,
          bytes: Buffer.from(chunk.bytes).toString('base64'),
          ...(yield* typedBy(caller, record)),
        };
      }),
      voice: saidLines(windowVoice),
    }),
  ),

  wait_terminal: pair(
    TERMINAL_OPERATIONS.wait_terminal,
    terminalBody(TERMINAL_OPERATIONS.wait_terminal, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.wait_terminal>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const record = yield* projected(caller, input.execution, input.incarnation);
        const waited = yield* (yield* Terminals).wait(record.execution, input.waitMs);
        return { waited, ...(yield* typedBy(caller, record)) };
      }),
      voice: saidLines(terminalWaitVoice),
    }),
  ),

  read_terminal_processes: pair(
    TERMINAL_OPERATIONS.read_terminal_processes,
    terminalBody(TERMINAL_OPERATIONS.read_terminal_processes, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.read_terminal_processes>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const record = yield* projected(caller, input.execution, input.incarnation);
        const report = yield* (yield* ExecutionProcessEvidence).processes(record.execution);
        return report === undefined ? {} : { report };
      }),
    }),
  ),

  read_terminal_ports: pair(
    TERMINAL_OPERATIONS.read_terminal_ports,
    terminalBody(TERMINAL_OPERATIONS.read_terminal_ports, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.read_terminal_ports>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const record = yield* projected(caller, input.execution, input.incarnation);
        const report = yield* (yield* ExecutionProcessEvidence).ports(record.execution);
        return report === undefined ? {} : { report };
      }),
    }),
  ),
};
