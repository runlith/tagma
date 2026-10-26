import { Effect } from 'effect';
import { BindingId } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { pair, type OperationPair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { readCommandFeed } from '../commands/feed.js';
import { LANE_OPERATIONS as OPS, type LaneOperationId } from '../contract/wire/operations/lanes.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { principalOf } from '../terminals/principals.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import { ViewId } from '../contract/wire/viewLeases.js';
import { TerminalAccess } from '../contract/service/access.js';
import { TerminalAdopters } from '../contract/service/adopters.js';
import { CommandReader } from '../contract/service/commands.js';
import { Custody } from '../contract/service/custody.js';
import { ExecutionProcessEvidence } from '../contract/service/records.js';
import { TERMINAL_PERMISSION_REVISION } from '../contract/service/subjectPolicy.js';
import { TerminalTargets } from '../contract/service/targets.js';
import { Terminals } from '../contract/service/terminals.js';
import { ViewLanes } from '../contract/service/views.js';
import { TerminalWriting } from '../contract/service/writing.js';
import { refuseThreadView } from '../terminals/lanes.js';
import { terminalBody } from './projection.js';
import { actorOf, projected } from './terminalReads.js';

const standingOf = (record: TerminalRecord) => ({
  projectId: record.projectId,
  holder: record.holder,
});

export const LANE_PAIRS: { readonly [K in LaneOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_command_feed: pair(
    OPS.read_command_feed,
    terminalBody(OPS.read_command_feed, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        return yield* readCommandFeed(
          yield* Terminals,
          yield* TerminalAdopters,
          yield* ExecutionProcessEvidence,
          yield* CommandReader,
          call.project.id,
          { ended: input.ended },
        );
      }),
    }),
  ),

  open_terminal_lane: pair(
    OPS.open_terminal_lane,
    terminalBody(OPS.open_terminal_lane, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const record = yield* projected(caller, input.execution, input.incarnation);
        const actor = yield* actorOf(caller);
        return yield* (yield* ViewLanes).open(actor, call.project.id, record.execution, ViewId.make(input.view));
      }),
    }),
  ),

  close_terminal_lane: pair(
    OPS.close_terminal_lane,
    terminalBody(OPS.close_terminal_lane, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const record = yield* projected(caller, input.execution, input.incarnation);
        const actor = yield* actorOf(caller);
        if (actor._tag !== 'Operator') return yield* refuseThreadView('a lane');
        return { closed: yield* (yield* ViewLanes).close(call.project.id, record.execution, BindingId.make(input.binding)) };
      }),
    }),
  ),

  take_over_terminal: pair(
    OPS.take_over_terminal,
    terminalBody(OPS.take_over_terminal, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const projectId = call.project.id;
        const record = yield* projected(caller, input.execution, input.incarnation);
        const actor = yield* actorOf(caller);
        if (actor._tag !== 'Operator') return yield* refuseThreadView('a Take over');
        const operator = principalOf({ _tag: 'Operator' });
        if (record.holder !== operator) {
          const target = yield* (yield* TerminalTargets).resolve({ projectId, kind: 'host', cwd: record.cwd ?? '.' });
          yield* (yield* TerminalAccess).prepare({
            actor,
            place: { _tag: 'Resolved', target, targetKey: record.targetKey },
            owner: record.holder,
            standing: standingOf(record),
            act: { _tag: 'Transfer', to: { _tag: 'Operator' } },
            subject: { _tag: 'Transfer', execution: record.execution, revision: record.revision, destination: operator },
          });
        }
        const answer = yield* (yield* Custody).takeOver({
          actor,
          projectId,
          operationId: HostRequestKey.make(input.operationId),
          execution: record.execution,
        });
        return { answer };
      }),
    }),
  ),

  input_terminal: pair(
    OPS.input_terminal,
    terminalBody(OPS.input_terminal, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        if (input.act._tag === 'Write' && (input.cause === 'interrupt' || input.cause === 'resize')) {
          return yield* new GateRefusal('body-shape', `Write input cannot carry cause ${input.cause}`, [
            'send the act the cause names: an Interrupt or a Resize',
          ]);
        }
        const call = yield* yield* CurrentProject;
        const projectId = call.project.id;
        const record = yield* projected(caller, input.execution, input.incarnation);
        const actor = yield* actorOf(caller);
        const binding = BindingId.make(input.binding);
        const decided = yield* (yield* TerminalAccess).prepare({
          actor,
          place: { _tag: 'Keyed', projectId, targetKey: record.targetKey },
          owner: record.holder,
          standing: standingOf(record),
          act: { _tag: 'Input' },
          subject: {
            _tag: 'Input',
            execution: record.execution,
            actor: principalOf(actor),
            binding,
            command: record.program ?? 'unknown',
          },
          interactive: { binding, permissionRevision: TERMINAL_PERMISSION_REVISION, execution: record.execution },
        });
        const grant = decided.grant;
        if (grant === undefined) {
          return yield* new TerminalRefused({ reason: 'no-grant', message: 'This input holds no live lane grant.' });
        }
        const answer = yield* (yield* TerminalWriting).input(
          record.execution,
          { binding: grant.binding, principal: grant.actor },
          {
            sequence: input.sequence,
            cause: input.cause,
            profile: input.profile,
            act:
              input.act._tag === 'Write'
                ? { _tag: 'Write', bytes: new Uint8Array(Buffer.from(input.act.bytes, 'base64')) }
                : input.act._tag === 'Resize'
                  ? { _tag: 'Resize', geometry: { rows: input.act.rows, columns: input.act.columns } }
                  : { _tag: 'Interrupt' },
          },
          TERMINAL_PERMISSION_REVISION,
        );
        return { answer };
      }),
    }),
  ),
};
