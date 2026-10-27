import { Effect } from 'effect';
import { BindingId } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { pair, type OperationPair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { readCommandFeed } from '../commands/feed.js';
import { LANE_OPERATIONS as OPS, type LaneOperationId } from '../contract/wire/operations/lanes.js';
import { principalOf } from '../terminals/principals.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import { ViewId } from '../contract/wire/viewLeases.js';
import { TerminalAccess } from '../contract/service/access.js';
import { TerminalAdopters } from '../contract/service/adopters.js';
import { CommandReader } from '../contract/service/commands.js';
import { Custody } from '../contract/service/custody.js';
import { ExecutionProcessEvidence } from '../contract/service/records.js';
import { TerminalTargets } from '../contract/service/targets.js';
import { Terminals } from '../contract/service/terminals.js';
import { LaneEndpoint, ViewLanes } from '../contract/service/views.js';
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
        const lanes = yield* ViewLanes;
        const device = caller.actor.kind === 'operator' ? (caller.actor.deviceId ?? null) : null;
        const opened = yield* lanes.open(actor, call.project.id, record.execution, ViewId.make(input.view), device);
        const url = yield* (yield* LaneEndpoint)
          .address(opened.lane.port)
          .pipe(Effect.tapError(() => lanes.close(call.project.id, record.execution, opened.binding)));
        return { binding: opened.binding, url, token: opened.lane.token, next: opened.lane.next };
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
};
