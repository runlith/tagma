import { Effect } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import { pair, type OperationPair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { HostManagement } from '../contract/service/host.js';
import { RESIDUAL_OPERATIONS as OPS, type ResidualOperationId } from '../contract/wire/operations/residuals.js';
import type { ResidualOutcome } from '../contract/wire/residuals.js';
import { executionPolicy } from '../host/policy.js';
import { terminalBody } from './projection.js';

const OUTCOME_BYTES = 1024;
const BATCH_MAX = Math.floor(executionPolicy.execution.frame.bytes / OUTCOME_BYTES);
const AT_A_TIME = 3;

const detailOf = (failure: ExecutionsFailure): string => {
  switch (failure._tag) {
    case 'HostRefused':
      return failure.refusal.reason;
    case 'WireLost':
    case 'WireUnavailable':
      return failure.reason;
    case 'WireInvalid':
    case 'WireUnreadable':
      return failure.detail;
    case 'WireFailed':
      return failure.fault.detail;
  }
};

export const RESIDUAL_PAIRS: { readonly [K in ResidualOperationId]: OperationPair<(typeof OPS)[K]> } = {
  end_residual: pair(
    OPS.end_residual,
    terminalBody(OPS.end_residual, {
      execute: Effect.fnUntraced(function* (input) {
        const host = yield* HostManagement;
        return { outcome: yield* host.connection.port.endResidual(input.origin, input.pid) };
      }),
    }),
  ),

  end_residuals: pair(
    OPS.end_residuals,
    terminalBody(OPS.end_residuals, {
      execute: Effect.fnUntraced(function* (input) {
        if (input.residuals.length > BATCH_MAX) {
          return yield* new GateRefusal(
            'body-shape',
            `${input.residuals.length} residuals exceed the ${BATCH_MAX} outcomes one answer frame can carry`,
            [`send at most ${BATCH_MAX} residuals in one act`],
          );
        }
        const port = (yield* HostManagement).connection.port;
        const outcomes = yield* Effect.forEach(
          input.residuals,
          (residual) =>
            Effect.map(Effect.result(port.endResidual(residual.origin, residual.pid)), (result): ResidualOutcome =>
              result._tag === 'Success'
                ? result.success
                : {
                    _tag: 'Unreached',
                    origin: residual.origin,
                    pid: residual.pid,
                    failure: result.failure._tag,
                    detail: detailOf(result.failure),
                  },
            ),
          { concurrency: AT_A_TIME },
        );
        return { outcomes };
      }),
    }),
  ),
};
