import { Effect, Option, Stream } from 'effect';
import { pair, type OperationPair } from '../../platform/contract/service/body.js';
import { LoadFeed } from '../contract/service/load.js';
import { HostManagement } from '../contract/service/host.js';
import { appliedMachineLoad, type MachineLoadSnapshot } from '../contract/wire/load.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import {
  MACHINE_OPERATIONS as OPS,
  machineLimit,
  ROW_PROCESSES,
  type MachineOperationId,
  type MachineReport,
} from '../contract/wire/operations/machine.js';
import { terminalBody } from './projection.js';
import { saidLines } from '../../platform/contract/service/presentation.js';
import { machineVoice } from '../voice/machine.js';

const ENDINGS_AT_ONCE = 3;

export const MACHINE_PAIRS = {
  read_machine_load: pair(
    OPS.read_machine_load,
    terminalBody<typeof OPS.read_machine_load, undefined, never, LoadFeed>(OPS.read_machine_load, {
      execute: Effect.fnUntraced(function* (input) {
        const feed = yield* LoadFeed;
        let held: MachineLoadSnapshot | undefined;
        const state = yield* feed.machine().pipe(
          Stream.tap((frame) =>
            frame._tag === 'Snapshot' ? feed.interest(frame.snapshot.reader, { interested: true, others: true }) : Effect.void,
          ),
          Stream.map((frame) => {
            held = frame._tag === 'Snapshot' ? frame.snapshot : held === undefined ? undefined : appliedMachineLoad(held, frame.delta);
            return held?.state;
          }),
          Stream.filter(
            (state) => state !== undefined && state._tag !== 'Waiting' && !(state._tag === 'Read' && state.view.share === null),
          ),
          Stream.runHead,
        );
        if (Option.isNone(state) || state.value === undefined)
          return yield* new TerminalUnavailable({ owner: 'host', message: 'The machine load subscription ended before a reading.' });
        const answer = state.value;
        if (answer._tag !== 'Read') return { state: answer, shown: 0 };
        const view = answer.view;
        const rows =
          input.pid === undefined
            ? view.rows.slice(0, machineLimit(input.limit)).map((row) => ({
                ...row,
                processes: row.processes.slice(0, ROW_PROCESSES),
                more: Math.max(0, row.processes.length - ROW_PROCESSES),
              }))
            : view.rows.flatMap((row) => {
                const one = row.processes.filter((process) => process.pid === input.pid);
                return one.length === 0 ? [] : [{ ...row, processes: one, more: row.processes.length - one.length }];
              });
        const report: MachineReport = {
          _tag: 'Read',
          cores: view.cores,
          machine: view.machine,
          share: view.share,
          memory: view.memory,
          saturated: view.saturated,
          rows,
          total: view.rows.length,
          totals: view.totals,
          top: view.top,
          background: view.background,
          unresolved: view.unresolved,
          unread: view.unread,
        };
        return { state: report, shown: rows.length };
      }),
      voice: saidLines(machineVoice),
    }),
  ),
  end_machine_process: pair(
    OPS.end_machine_process,
    terminalBody<typeof OPS.end_machine_process, undefined, never, HostManagement>(OPS.end_machine_process, {
      execute: Effect.fnUntraced(function* (input) {
        const host = yield* HostManagement;
        const outcomes = yield* Effect.forEach(input.targets, (target) => host.connection.port.endProcess(target), {
          concurrency: ENDINGS_AT_ONCE,
        });
        return { outcomes };
      }),
    }),
  ),
} satisfies { readonly [K in MachineOperationId]: OperationPair<(typeof OPS)[K]> };
