import { Clock, Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { NextInstallation } from '../contract/service/next.js';
import { MachineHost } from '../contract/service/machineHost.js';
import { MachineAgents } from '../contract/service/agents.js';
import { LiveWorks } from '../../platform/contract/service/live.js';
import { ServerProcess, Succession } from '../contract/service/succession.js';
import { RestartRecords } from '../contract/service/restarts.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import { InstalledChannel } from '../contract/service/channel.js';
import { launcherPath } from '../paths.js';
import { launcherStands } from '../setup/launcher.js';
import { shellEnv } from './command.js';
import { newHostOf, waitingOf } from '../newHost.js';

export const readMachineState = pair(
  OPS.read_machine_state,
  body(OPS.read_machine_state, {
    execute: Effect.fnUntraced(function* () {
      const { born, source } = yield* ServerProcess;
      const succession = yield* Succession;
      const nextInstallation = yield* NextInstallation;
      const machineHost = yield* MachineHost;
      const standing = yield* Effect.result(succession.current);
      if (standing._tag === 'Failure') yield* Effect.logWarning('the standing installation was not read', standing.failure);
      const current = standing._tag === 'Success' ? standing.success : null;
      const runs = source.installation;
      const waiting = waitingOf(current, runs, yield* succession.refused);
      const [host, next, agents, work] = yield* Effect.all(
        [
          machineHost.standing,
          nextInstallation.reading,
          (yield* MachineAgents).working,
          Effect.forEach((yield* LiveWorks).all, (one) =>
            Effect.map(one.count, (count) => ({ id: one.id, count, one: one.ends.one, many: one.ends.many })),
          ),
        ],
        { concurrency: 3 },
      );
      const records = yield* RestartRecords;
      const restart = yield* records.state;
      const channel = yield* InstalledChannel;
      const newHost = yield* newHostOf(succession, machineHost, waiting, runs?.build ?? null, host.build, next.back?.id ?? null);
      return {
        status: 'read' as const,
        machine: {
          newHost,
          readAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          server: {
            pid: process.pid,
            startedAt: born.startedAt,
            agents,
            calls: work.reduce((sum, one) => sum + one.count, 0),
            work,
            born: { replacedPid: born.replacedPid },
            installation: runs,
            cut: source.cut,
            waiting,
            next,
          },
          host,
          acts: [
            { act: 'restart' as const, command: `${channel.command} restart`, disabled: yield* succession.unready },
            {
              act: 'command' as const,
              command: `${channel.command} release path`,
              disabled: launcherStands(launcherPath(channel), shellEnv(channel), process.platform)
                ? `a new shell finds ${channel.command} already`
                : null,
            },
          ],
          restart,
        },
      };
    }),
  }),
);
