import type { Raised } from '@runlith/agent/permissions';
import { said, saidLines } from '../../platform/contract/service/presentation.js';
import { Effect } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { CommandRevision } from '@runlith/executions/protocol/command';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { pair, type InputOf } from '../../platform/contract/service/body.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';
import { subjectOfKey } from '../contract/wire/commandSubject.js';
import { CommandCursor } from '../contract/wire/commands.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { principalOf } from '../terminals/principals.js';
import {
  CommandAccess,
  type CommandPreparation,
  type ObservePreparation,
  type RevisePreparation,
  type StopPreparation,
} from '../contract/service/access.js';
import { CommandReader } from '../contract/service/commands.js';
import { ManagedCommands } from '../contract/service/commands.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { actorOf } from './terminalReads.js';
import { terminalBody } from './projection.js';
import { COMMAND_OPERATIONS, OUTPUT_MATCHES } from '../contract/wire/operations/commandCatalog.js';
import { commandVoice, limitText, listingText, outputText, searchText, stopText } from '../voice/commands.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { pageRows } from '@runlith/paging';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { windowVoice } from '../voice/byteWindow.js';

type CeilingTerms = { readonly act: RevisePreparation; readonly consents: readonly Raised[] };

type CommandRequirements = CommandReader | CommandAccess | ManagedCommands | CurrentProject;

const wrongAct = (named: string): GateRefusal<'terminal-stale-authority'> =>
  new GateRefusal('terminal-stale-authority', `this ${named} was prepared for another act`, [
    `prepare a ${named} over the execution it names`,
  ]);

const authority = <P extends CommandPreparation>(access: CommandAccess['Service'], act: P) => ({
  prepared: act,
  recheck: (unit: Parameters<CommandAccess['Service']['recheck']>[0]) => access.recheck(unit, act),
});

const observerOf = (caller: Caller) => (caller.actor.kind === 'session' ? Effect.succeed({ _tag: 'Operator' as const }) : actorOf(caller));

const placed = Effect.fn('commands.placed')(function* (
  caller: Caller,
  input: { readonly execution: string; readonly incarnation: number },
) {
  const call = yield* yield* CurrentProject;
  const row = yield* (yield* ManagedCommands).record(input.execution, input.incarnation);
  if (row === null || row.projectId !== call.project.id) {
    return yield* new TerminalRefused({
      reason: 'no-command',
      message: `This installation holds no command under ${input.execution} at incarnation ${input.incarnation}; read the inventory again.`,
    });
  }
  return row;
});

const observed = Effect.fnUntraced(function* (caller: Caller, input: { readonly execution: string; readonly incarnation: number }) {
  const call = yield* yield* CurrentProject;
  const row = yield* placed(caller, input);
  const prepared = yield* (yield* CommandAccess).prepare({
    _tag: 'Observe',
    actor: yield* observerOf(caller),
    scope: call.project.id,
    execution: row.execution,
  });
  if (prepared.request._tag !== 'Observe') return yield* wrongAct('read');
  return { ...prepared, request: prepared.request } satisfies ObservePreparation;
});

const SEARCH_CEILING = ceilingOf(OUTPUT_MATCHES);

const SEARCH_BUDGET = TOOL_OUTPUT_MAX_BYTES - 4096;

export const COMMAND_PAIRS = {
  read_commands: pair(
    COMMAND_OPERATIONS.read_commands,
    terminalBody(COMMAND_OPERATIONS.read_commands, {
      execute: Effect.fnUntraced(function* (input: InputOf<typeof COMMAND_OPERATIONS.read_commands>, _prepared: undefined) {
        const call = yield* yield* CurrentProject;
        const owner = input.owner === undefined ? null : subjectOfKey(input.owner);
        if (input.owner !== undefined && owner === null) {
          return yield* new TerminalRefused({
            reason: 'no-owner',
            message: `\`${input.owner}\` is not an owner key; name one as a row spells it: thread:<id>, operator, or service:<scope>.`,
          });
        }
        return yield* (yield* CommandReader).page(call.project.id, {
          owner: owner ?? undefined,
          standing: input.standing,
          order: input.order,
          after: input.after === undefined ? undefined : CommandCursor.make(input.after),
          limit: input.limit,
        });
      }),
      voice: said(listingText),
    }),
  ),

  read_command: pair(
    COMMAND_OPERATIONS.read_command,
    terminalBody(COMMAND_OPERATIONS.read_command, {
      execute: Effect.fnUntraced(function* (input: InputOf<typeof COMMAND_OPERATIONS.read_command>, _prepared: undefined) {
        const call = yield* yield* CurrentProject;
        return yield* (yield* CommandReader).one(call.project.id, input.execution, input.incarnation);
      }),
      voice: saidLines(commandVoice),
    }),
  ),

  read_command_bytes: pair(
    COMMAND_OPERATIONS.read_command_bytes,
    terminalBody(COMMAND_OPERATIONS.read_command_bytes, {
      prepare: Effect.fn('read_command_bytes.prepare')(function* (
        input: InputOf<typeof COMMAND_OPERATIONS.read_command_bytes>,
        caller: Caller,
      ) {
        return yield* observed(caller, input);
      }),
      execute: Effect.fnUntraced(function* (input: InputOf<typeof COMMAND_OPERATIONS.read_command_bytes>, prepared: ObservePreparation) {
        const access = yield* CommandAccess;
        const chunk = yield* (yield* ManagedCommands).bytes(
          { ref: prepared.request.execution, stream: input.stream, offset: input.offset },
          input.limit ?? 65_536,
          authority(access, prepared),
          { withPositions: input.positions !== false },
        );
        return {
          range: chunk.range,
          positions: chunk.positions,
          bytes: Buffer.from(chunk.bytes).toString('base64'),
        };
      }),
      voice: saidLines(windowVoice),
    }),
  ),

  search_output: pair(
    COMMAND_OPERATIONS.search_output,
    terminalBody(COMMAND_OPERATIONS.search_output, {
      prepare: Effect.fn('search_output.prepare')(function* (input: InputOf<typeof COMMAND_OPERATIONS.search_output>, caller: Caller) {
        return yield* observed(caller, input);
      }),
      execute: Effect.fnUntraced(function* (input: InputOf<typeof COMMAND_OPERATIONS.search_output>, prepared: ObservePreparation) {
        const call = yield* yield* CurrentProject;
        const access = yield* CommandAccess;
        const before = input.before ?? 0;
        const after = input.after ?? 0;
        const rows = pageRows(input.limit, OUTPUT_MATCHES, SEARCH_CEILING);
        return yield* (yield* CommandReader).search({
          projectId: call.project.id,
          execution: prepared.request.execution,
          authority: authority(access, prepared),
          pattern: input.pattern,
          stream: input.stream,
          ignoreCase: input.ignoreCase,
          before,
          after,
          limit: Math.max(1, Math.min(rows, Math.floor(SEARCH_CEILING / (1 + before + after)))),
          budget: SEARCH_BUDGET,
          cursor: input.cursor,
        });
      }),
      voice: said(searchText),
    }),
  ),

  read_output: pair(
    COMMAND_OPERATIONS.read_output,
    terminalBody(COMMAND_OPERATIONS.read_output, {
      prepare: Effect.fn('read_output.prepare')(function* (input: InputOf<typeof COMMAND_OPERATIONS.read_output>, caller: Caller) {
        const call = yield* yield* CurrentProject;
        const row = yield* placed(caller, input);
        const actor = yield* observerOf(caller);
        const observe = yield* (yield* CommandAccess).prepare({ _tag: 'Observe', actor, scope: call.project.id, execution: row.execution });
        if (observe.request._tag !== 'Observe') return yield* wrongAct('read');
        const observing = { ...observe, request: observe.request } satisfies ObservePreparation;
        return { observing, reader: principalOf(actor), thread: actor._tag === 'Thread' ? actor.threadId : undefined };
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof COMMAND_OPERATIONS.read_output>,
        prepared: { readonly observing: ObservePreparation; readonly reader: string; readonly thread: ThreadId | undefined },
      ) {
        const call = yield* yield* CurrentProject;
        const access = yield* CommandAccess;
        return yield* (yield* CommandReader).output({
          projectId: call.project.id,
          reader: prepared.reader,
          thread: prepared.thread,
          execution: prepared.observing.request.execution,
          authority: authority(access, prepared.observing),
          tail: input.tail,
        });
      }),
      voice: said(outputText),
    }),
  ),

  change_command_limit: pair(
    COMMAND_OPERATIONS.change_command_limit,
    terminalBody(COMMAND_OPERATIONS.change_command_limit, {
      prepare: Effect.fn('change_command_limit.prepare')(function* (
        input: InputOf<typeof COMMAND_OPERATIONS.change_command_limit>,
        caller: Caller,
      ) {
        const call = yield* yield* CurrentProject;
        const row = yield* placed(caller, input);
        const actor = yield* actorOf(caller);
        const access = yield* CommandAccess;
        const revising = (exceptionMs: number | undefined) =>
          access.prepare({
            _tag: 'Revise',
            actor,
            scope: call.project.id,
            execution: row.execution,
            change: input.change,
            exceptionMs: exceptionMs,
          });
        const first = yield* revising(input.exceptionMs);
        const ceilingMs = first.request._tag === 'Revise' ? first.request.current.ceilingMs : undefined;
        const past =
          input.exceptionMs === undefined &&
          input.change._tag === 'Total' &&
          ceilingMs !== undefined &&
          input.change.executionMs > ceilingMs;
        const act = past && input.change._tag === 'Total' ? yield* revising(input.change.executionMs) : first;
        const { request, revision } = act;
        if (request._tag !== 'Revise' || revision === undefined) return yield* wrongAct('limit change');
        const raised = request.exceptionMs;
        const consents: readonly Raised[] =
          actor._tag === 'Thread' && raised !== undefined
            ? [
                {
                  condition: 'command-ceiling',
                  fact: `${row.execution.execution}'s command rule holds ${ceilingMs === undefined ? 'no ceiling' : `a ceiling of ${ceilingMs} ms`}; this moves its ceiling to ${raised} ms`,
                },
              ]
            : [];
        return { act: { ...act, request, revision } satisfies RevisePreparation, consents } satisfies CeilingTerms;
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof COMMAND_OPERATIONS.change_command_limit>,
        terms: CeilingTerms,
        caller: Caller,
      ) {
        const prepared = terms.act;
        const call = yield* yield* CurrentProject;
        const access = yield* CommandAccess;
        const outcome = yield* (yield* ManagedCommands).revise(
          {
            projectId: call.project.id,
            operationId: HostRequestKey.make(input.operationId),
            requester: principalOf(yield* actorOf(caller)),
            mutation: 'limit',
            targetKey: prepared.targetKey,
            execution: prepared.request.execution,
          },
          prepared.request.execution,
          authority(access, prepared),
          input.cause,
          CommandRevision.make(input.expected),
        );
        return { outcome };
      }),
      voice: said(limitText),
    }),
  ),

  stop_command: pair(
    COMMAND_OPERATIONS.stop_command,
    terminalBody(COMMAND_OPERATIONS.stop_command, {
      prepare: Effect.fn('stop_command.prepare')(function* (input: InputOf<typeof COMMAND_OPERATIONS.stop_command>, caller: Caller) {
        const call = yield* yield* CurrentProject;
        const row = yield* placed(caller, input);
        const act = yield* (yield* CommandAccess).prepare({
          _tag: 'Stop',
          actor: yield* actorOf(caller),
          scope: call.project.id,
          execution: row.execution,
        });
        const { request } = act;
        if (request._tag !== 'Stop') return yield* wrongAct('stop');
        return { ...act, request } satisfies StopPreparation;
      }),
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof COMMAND_OPERATIONS.stop_command>,
        prepared: StopPreparation,
        caller: Caller,
      ) {
        const call = yield* yield* CurrentProject;
        const access = yield* CommandAccess;
        const receipt = yield* (yield* ManagedCommands).stop(
          call.project.id,
          {
            projectId: call.project.id,
            operationId: HostRequestKey.make(input.operationId),
            requester: principalOf(yield* actorOf(caller)),
            mutation: 'stop',
            targetKey: prepared.targetKey,
            execution: prepared.request.execution,
          },
          prepared.request.execution,
          authority(access, prepared),
          input.cause,
          input.action ?? 'signal',
        );
        return { receipt };
      }),
      voice: said(stopText),
    }),
  ),
};
