import { Clock, Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Api } from '../../http/contract/wire/Api.js';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import { FrozenBuilds } from '../../installation/contract/service/builds.js';
import type { Succession } from '../../installation/contract/service/succession.js';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { RuntimeStatus } from './status.js';
import { RestartRecords } from '../../installation/contract/service/restarts.js';
import { handoverOf } from '../../installation/process/record.js';

export const healthHandler = (status: RuntimeStatus, succession: Succession['Service'], machine: MachineStore['Service']) =>
  HttpApiBuilder.group(
    Api,
    'health',
    Effect.fn(function* (handlers) {
      const builds = yield* FrozenBuilds;
      const sessionIdentity = yield* SessionIdentity;
      const records = yield* RestartRecords;
      return handlers
        .handle('health', () =>
          Effect.gen(function* () {
            const frozen = yield* builds.state;
            const standing = yield* Effect.result(succession.current);
            const current = standing._tag === 'Success' ? standing.success : null;
            const stalled = yield* machine.stalled;
            return {
              ok: true as const,
              ...status,
              builds: frozen,
              sessionIdentity,
              standing: current === null ? null : { build: current.manifest.identity.build, digest: current.manifest.identity.digest },
              stalled: stalled === null ? null : { pid: process.pid, database: machine.path, ...stalled },
            };
          }),
        )
        .handle('startup', () =>
          Effect.gen(function* () {
            const state = yield* records.state;
            return { startup: state.startup, issue: state.issue, restart: handoverOf(state, yield* Clock.currentTimeMillis) };
          }),
        );
    }),
  );
