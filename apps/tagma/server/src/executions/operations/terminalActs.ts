import { Effect, Option } from 'effect';
import { type Raised, type PermissionSubject } from '@runlith/agent/permissions';
import { HostRefused } from '@runlith/executions/Executions';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CustodyTransfer } from '@runlith/executions/protocol/control';
import type { InputInstruction } from '@runlith/executions/protocol/input';
import { GateRefusal, cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { mintShellKey } from '../../platform/credentials/grants.js';
import { pair, type InputOf } from '../../platform/contract/service/body.js';
import { said, saidLines } from '../../platform/contract/service/presentation.js';
import { stopText } from '../voice/commands.js';
import { operationVoice } from '../voice/operation.js';
import { executionActorOf } from '../terminals/principals.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { TERMINAL_OPERATIONS, TERMINALS } from '../contract/wire/operations/terminalCatalog.js';
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
import { startDeclaration } from '../terminals/declaration.js';
import { requestedEnvironment } from '../terminals/environment.js';
import { TERMINAL_PERMISSION_REVISION, type TerminalPlace } from '../contract/service/subjectPolicy.js';
import { targetIdentity, targetKeyOf } from '../terminals/subjectPolicy.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';

import { actorOf, projected } from './terminalReads.js';
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

type PreparedStart = {
  readonly subjects: readonly PermissionSubject[];
  readonly target: ResolvedExecutionTarget;
  readonly targetKey: TargetKey;
  readonly program: string;
  readonly args: readonly string[];
};

const loginShell = (): string => {
  const shell = process.env.SHELL;
  return shell !== undefined && shell.trim() !== '' ? shell : '/bin/sh';
};

type PreparedAct = {
  readonly subjects: readonly PermissionSubject[];
  readonly raised?: readonly Raised[];
  readonly record: TerminalRecord;
  readonly grant?: InteractiveGrant;
  readonly decisionRevision: number;
  readonly opened?: BindingId;
  readonly takes?: true;
};

const holderWords = (holder: string | undefined): string =>
  holder === undefined ? 'nobody' : holder === principalOf({ _tag: 'Operator' }) ? 'the operator' : holder;

const custodyConsent = (record: TerminalRecord, act: string): Raised => ({
  condition: 'not-holder',
  fact: `execution ${record.execution.execution} (${record.program ?? 'unknown program'}) is held by ${holderWords(record.holder)}; ${act}`,
});

const foreign = (actor: TerminalActor, record: TerminalRecord): boolean => actor._tag === 'Thread' && record.holder !== principalOf(actor);

const standing = Effect.fn('terminals.standing')(function* (caller: Caller, execution: string, incarnation: number) {
  const call = yield* yield* CurrentProject;
  const record = yield* projected(caller, execution, incarnation);
  const target = yield* (yield* TerminalTargets).resolve({
    projectId: call.project.id,
    kind: 'host',
    cwd: record.cwd ?? '.',
  });
  return { record, place: { _tag: 'Resolved', target, targetKey: record.targetKey } satisfies TerminalPlace };
});

const deciding = Effect.fn('terminals.deciding')(function* (record: TerminalRecord, request: TerminalActRequest) {
  const decision = yield* (yield* TerminalAccess).prepare(request);
  return {
    subjects: decision.subjects,
    record,
    decisionRevision: TERMINAL_PERMISSION_REVISION,
    grant: decision.grant,
  } satisfies PreparedAct;
});

const preparing = Effect.fn('terminals.preparing')(function* (
  caller: Caller,
  execution: string,
  incarnation: number,
  request: (record: TerminalRecord, place: TerminalPlace) => TerminalActRequest,
) {
  const { record, place } = yield* standing(caller, execution, incarnation);
  return yield* deciding(record, request(record, place));
});

const typing = Effect.fn('terminals.typing')(function* (caller: Caller, execution: string, incarnation: number) {
  const record = yield* projected(caller, execution, incarnation);
  const run = (yield* ActingRun).runId;
  const actor = yield* actorOf(caller);
  const decision = yield* deciding(record, {
    actor,
    place: { _tag: 'Keyed', projectId: record.projectId, targetKey: record.targetKey },
    owner: record.holder,
    standing: { projectId: record.projectId, holder: record.holder },
    act: { _tag: 'Input' },
    subject: {
      _tag: 'Input',
      execution: record.execution,
      actor: principalOf(actor),
      run: run ?? principalOf(actor),
      command: record.program ?? 'unknown',
    },
  });
  if (!foreign(actor, record)) return { ...decision, run };
  return {
    ...decision,
    subjects: decision.subjects,
    raised: [custodyConsent(record, "it moves into this thread's custody, ending every lane typing into it, before this input")],
    takes: true as const,
    run,
  };
});

const admit = Effect.fn('terminals.admit')(function* (
  caller: Caller,
  prepared: PreparedAct & { readonly run: string | null },
  operationId: string,
  mutation: 'write' | 'interrupt' | 'resize',
  cause: 'typed' | 'paste' | 'raw' | 'interrupt' | 'resize',
  act: InputInstruction,
  profile?: number,
) {
  const actor = yield* actorOf(caller);
  const run = (yield* ActingRun).runId;
  if (run !== prepared.run) return yield* new TerminalRefused({ reason: 'stale', message: 'This input was prepared under another run.' });
  const record = prepared.record;
  if (prepared.takes === true) yield* takeCustody(actor, record, operationId);
  return yield* (yield* TerminalWriting).agentInput(
    keyOf(actor, record.projectId, record, operationId, mutation),
    run ?? undefined,
    act,
    cause,
    profile,
  );
});

const takeCustody = Effect.fn('terminals.takeCustody')(function* (actor: TerminalActor, record: TerminalRecord, operationId: string) {
  const moved = yield* (yield* Custody).move(
    record.projectId,
    keyOf(actor, record.projectId, record, `${operationId}:custody`, 'transfer'),
    record.execution,
    record.revision,
    { _tag: 'Transfer', holder: principalOf(actor) },
    record.holder,
  );
  if (moved._tag === 'Refused') return yield* new HostRefused({ refusal: moved.refusal });
  if (moved._tag === 'RevisionStale' || moved._tag === 'Uncertain') {
    return yield* new TerminalRefused({
      reason: 'stale',
      message: `custody of ${record.execution.execution} moved under this input, so nothing was typed; read the execution again`,
    });
  }
});

const inputAct = (
  act:
    | { readonly _tag: 'Write'; readonly bytes: string }
    | { readonly _tag: 'Interrupt' }
    | { readonly _tag: 'Resize'; readonly rows: number; readonly columns: number },
): InputInstruction => {
  if (act._tag === 'Write') return { _tag: 'Write', bytes: new Uint8Array(Buffer.from(act.bytes, 'base64')) };
  if (act._tag === 'Resize') return { _tag: 'Resize', geometry: { rows: act.rows, columns: act.columns } };
  return { _tag: 'Interrupt' };
};

const keyOf = (
  actor: TerminalActor,
  projectId: number,
  record: TerminalRecord,
  operationId: string,
  mutation: TerminalOperationKey['mutation'],
): TerminalOperationKey => ({
  projectId,
  operationId: HostRequestKey.make(operationId),
  requester: principalOf(actor),
  mutation,
  targetKey: record.targetKey,
  execution: record.execution,
});

const destinationOf = (thread: string | undefined, projectId: number) =>
  thread === undefined ? principalOf({ _tag: 'Operator' }) : principalOf({ _tag: 'Thread', threadId: ThreadId.make(thread), projectId });

export const TERMINAL_ACT_PAIRS = {
  start_terminal: pair(
    TERMINAL_OPERATIONS.start_terminal,
    terminalBody(TERMINAL_OPERATIONS.start_terminal, {
      prepare: Effect.fn('start_terminal.prepare')(function* (input: InputOf<typeof TERMINAL_OPERATIONS.start_terminal>, caller: Caller) {
        const program = input.program ?? loginShell();
        const args = input.program === undefined ? ['-l'] : (input.args ?? []);
        const call = yield* yield* CurrentProject;
        const actor = yield* actorOf(caller);
        const principal = principalOf(actor);
        const target = yield* (yield* TerminalTargets).resolve({
          projectId: call.project.id,
          kind: 'host',
          cwd: input.cwd,
        });
        const targetKey = targetKeyOf(targetIdentity(target, principal, principal));
        const declared = startDeclaration({
          actor: principal,
          operation: HostRequestKey.make(input.operationId),
          lifetime: input.lifetime,
          transport: input.transport,
          stdin: input.stdin,
        });
        if (declared._tag === 'Refused') return yield* declared.refusal;
        const decision = yield* (yield* TerminalAccess).prepare({
          actor,
          place: { _tag: 'Resolved', target, targetKey },
          owner: principal,
          standing: { projectId: call.project.id },
          act: { _tag: 'Start', holder: principal },
          subject: {
            _tag: 'Launch',
            operation: HostRequestKey.make(input.operationId),
            program,
            args,
            lifetime: input.lifetime,
            transport: input.transport,
            interactive: declared._tag === 'Interactive' ? declared.interactive : undefined,
          },
        });
        return { subjects: decision.subjects, target, targetKey, program, args } satisfies PreparedStart;
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.start_terminal>,
        prepared: PreparedStart,
        caller: Caller,
      ) {
        const call = yield* yield* CurrentProject;
        const actor = yield* actorOf(caller);
        const run = (yield* ActingRun).runId;
        const terminals = yield* Terminals;
        const declared = startDeclaration({
          actor: principalOf(actor),
          operation: HostRequestKey.make(input.operationId),
          lifetime: input.lifetime,
          transport: input.transport,
          stdin: input.stdin,
        });
        if (declared._tag === 'Refused') return yield* declared.refusal;
        const geometry =
          input.transport === 'pty' && input.geometry === undefined ? (yield* (yield* HostManagement).standing).geometry : input.geometry;
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const receipt = yield* terminals.start({
              actor,
              operationId: HostRequestKey.make(input.operationId),
              target: prepared.target,
              targetKey: prepared.targetKey,
              program: prepared.program,
              args: prepared.args,
              label: input.label,
              environment: input.env === undefined ? undefined : requestedEnvironment(input.env),
              transport: input.transport,
              lifetime: input.lifetime,
              stdin: input.stdin,
              geometry: geometry,
              shellKey: actor._tag === 'Operator' && input.transport === 'pty' ? mintShellKey() : undefined,
              interactive:
                declared._tag !== 'Interactive'
                  ? undefined
                  : {
                      revision: TERMINAL_PERMISSION_REVISION,
                      runId: run ?? undefined,
                    },
            });
            if (receipt._tag === 'Refused') return yield* receipt.refusal;
            return {
              operation: yield* (yield* TerminalRequests).requestFor(actor, call.project.id, HostRequestKey.make(input.operationId)),
            };
          }),
        );
      }),
      voice: saidLines(operationVoice),
    }),
  ),

  write_terminal: pair(
    TERMINAL_OPERATIONS.write_terminal,
    terminalBody(TERMINAL_OPERATIONS.write_terminal, {
      prepare: Effect.fn('write_terminal.prepare')(function* (input: InputOf<typeof TERMINAL_OPERATIONS.write_terminal>, caller: Caller) {
        return yield* typing(caller, input.execution, input.incarnation);
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.write_terminal>,
        prepared: PreparedAct & { readonly run: string | null },
        caller: Caller,
      ) {
        const outcome = yield* admit(
          caller,
          prepared,
          input.operationId,
          'write',
          input.cause ?? 'raw',
          inputAct({ _tag: 'Write', bytes: input.bytes }),
          input.profile,
        );
        return { outcome };
      }),
    }),
  ),

  interrupt_terminal: pair(
    TERMINAL_OPERATIONS.interrupt_terminal,
    terminalBody(TERMINAL_OPERATIONS.interrupt_terminal, {
      prepare: Effect.fn('interrupt_terminal.prepare')(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.interrupt_terminal>,
        caller: Caller,
      ) {
        return yield* typing(caller, input.execution, input.incarnation);
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.interrupt_terminal>,
        prepared: PreparedAct & { readonly run: string | null },
        caller: Caller,
      ) {
        const outcome = yield* admit(caller, prepared, input.operationId, 'interrupt', 'interrupt', { _tag: 'Interrupt' }, input.profile);
        return { outcome };
      }),
    }),
  ),

  resize_terminal: pair(
    TERMINAL_OPERATIONS.resize_terminal,
    terminalBody(TERMINAL_OPERATIONS.resize_terminal, {
      prepare: Effect.fn('resize_terminal.prepare')(function* (input: InputOf<typeof TERMINAL_OPERATIONS.resize_terminal>, caller: Caller) {
        return yield* typing(caller, input.execution, input.incarnation);
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.resize_terminal>,
        prepared: PreparedAct & { readonly run: string | null },
        caller: Caller,
      ) {
        const outcome = yield* admit(
          caller,
          prepared,
          input.operationId,
          'resize',
          'resize',
          { _tag: 'Resize', geometry: { rows: input.rows, columns: input.columns } },
          input.profile,
        );
        return { outcome };
      }),
    }),
  ),

  transfer_terminal: pair(
    TERMINAL_OPERATIONS.transfer_terminal,
    terminalBody(TERMINAL_OPERATIONS.transfer_terminal, {
      prepare: Effect.fn('transfer_terminal.prepare')(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.transfer_terminal>,
        caller: Caller,
      ) {
        const actor = yield* actorOf(caller);
        const decided = yield* preparing(caller, input.execution, input.incarnation, (record, place) => ({
          actor,
          place,
          owner: record.holder,
          standing: { projectId: record.projectId, holder: record.holder },
          act: {
            _tag: 'Transfer',
            to: input.thread === undefined ? { _tag: 'Operator' } : { _tag: 'Thread', threadId: ThreadId.make(input.thread) },
          },
          subject: {
            _tag: 'Transfer',
            execution: record.execution,
            revision: input.expected,
            destination: destinationOf(input.thread, record.projectId),
          },
        }));
        if (!foreign(actor, decided.record)) return decided;
        const to = input.thread === undefined ? 'the operator' : `thread ${input.thread}`;
        return {
          ...decided,
          raised: [custodyConsent(decided.record, `it moves to ${to}, ending every lane typing into it`)],
        };
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.transfer_terminal>,
        prepared: PreparedAct,
        caller: Caller,
      ) {
        const call = yield* yield* CurrentProject;
        const terminals = yield* Terminals;
        const record = prepared.record;
        const actor = yield* actorOf(caller);
        const act: CustodyTransfer = { _tag: 'Transfer', holder: destinationOf(input.thread, record.projectId) };
        const outcome = yield* (yield* Custody).move(
          call.project.id,
          keyOf(actor, call.project.id, record, input.operationId, 'transfer'),
          record.execution,
          input.expected,
          act,
          record.holder,
        );
        if (outcome._tag === 'Refused') return yield* new HostRefused({ refusal: outcome.refusal });
        const now = yield* terminals.record(record.execution.execution, record.execution.incarnation);
        return { outcome, terminal: now === null ? null : terminalView(now) };
      }),
    }),
  ),

  signal_terminal: pair(
    TERMINAL_OPERATIONS.signal_terminal,
    terminalBody(TERMINAL_OPERATIONS.signal_terminal, {
      prepare: Effect.fn('signal_terminal.prepare')(function* (input: InputOf<typeof TERMINAL_OPERATIONS.signal_terminal>, caller: Caller) {
        const actor = yield* actorOf(caller);
        return yield* preparing(caller, input.execution, input.incarnation, (record, place) => ({
          actor,
          place,
          owner: record.holder,
          standing: { projectId: record.projectId, holder: record.holder },
          act: { _tag: 'Signal' },
          subject: {
            _tag: 'Signal',
            execution: record.execution,
            revision: record.revision,
            signal: input.signal,
          },
        }));
      }),
      execute: Effect.fnUntraced(function* (input: InputOf<typeof TERMINAL_OPERATIONS.signal_terminal>, prepared: PreparedAct) {
        const outcome = yield* (yield* Terminals).signal(prepared.record.execution, input.signal, prepared.record.revision);
        return { outcome };
      }),
    }),
  ),

  stop_terminal: pair(
    TERMINAL_OPERATIONS.stop_terminal,
    terminalBody(TERMINAL_OPERATIONS.stop_terminal, {
      prepare: Effect.fn('stop_terminal.prepare')(function* (input: InputOf<typeof TERMINAL_OPERATIONS.stop_terminal>, caller: Caller) {
        const actor = yield* actorOf(caller);
        return yield* preparing(caller, input.execution, input.incarnation, (record, place) => ({
          actor,
          place,
          owner: record.holder,
          standing: { projectId: record.projectId, holder: record.holder },
          act: { _tag: 'Stop' },
          subject: { _tag: 'Stop', execution: record.execution, revision: record.revision },
        }));
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof TERMINAL_OPERATIONS.stop_terminal>,
        prepared: PreparedAct,
        caller: Caller,
      ) {
        const call = yield* yield* CurrentProject;
        const actor = yield* actorOf(caller);
        const receipt = yield* (yield* Terminals).stop(
          call.project.id,
          keyOf(actor, call.project.id, prepared.record, input.operationId, 'stop'),
          prepared.record.execution,
          prepared.record.revision,
          input.cause,
          input.action ?? 'signal',
        );
        return { receipt };
      }),
      voice: said(stopText),
    }),
  ),
};
