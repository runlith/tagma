import { Clock, Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { NextInstallation } from '../contract/service/next.js';
import { MachineHost } from '../contract/service/machineHost.js';
import { MachineAgents } from '../contract/service/agents.js';
import { MachineCalls } from '../contract/service/calls.js';
import { ServerProcess, Succession } from '../contract/service/succession.js';
import { RestartRecords } from '../contract/service/restarts.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import { InstalledChannel } from '../contract/service/channel.js';
import { launcherPath } from '../paths.js';
import { launcherStands } from '../setup/launcher.js';
import { shellEnv } from './command.js';

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
      const waiting =
        current !== null && runs !== null && current.manifest.identity.build !== runs.build
          ? { build: current.manifest.identity.build, digest: current.manifest.identity.digest }
          : null;
      const [host, next, agents, calls] = yield* Effect.all(
        [machineHost.standing, nextInstallation.reading, (yield* MachineAgents).working, (yield* MachineCalls).live],
        { concurrency: 3 },
      );
      const records = yield* RestartRecords;
      const restart = yield* records.state;
      const channel = yield* InstalledChannel;
      return {
        status: 'read' as const,
        machine: {
          readAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          server: {
            pid: process.pid,
            startedAt: born.startedAt,
            agents,
            calls,
            born: { replacedPid: born.replacedPid },
            installation: runs,
            cut: source.cut,
            waiting,
            next,
          },
          host,
          acts: [
            { act: 'restart' as const, command: `${channel.command} restart`, disabled: null },
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
