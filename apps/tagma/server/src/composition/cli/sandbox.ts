import { Effect } from 'effect';
import type { SandboxCli } from '../../sandbox/cli/port.js';
import { GUEST_OPERATIONS } from '../../sandbox/contract/wire/operations/guest.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { lens } from '../../cli/door.js';
import { perform } from './perform.js';
import { ROUTE_OPERATIONS } from '../../threads/contract/wire/operations/routes.js';

export const sandboxCli: SandboxCli = {
  list: (project) =>
    Effect.flatMap(CurrentInvocation, (at) =>
      Effect.map(perform(GUEST_OPERATIONS.read_sandbox, {}, lens(at, { project })), (answer) => answer.sandboxes ?? []),
    ),
  birth: (input) =>
    Effect.flatMap(CurrentInvocation, (at) =>
      perform(
        ROUTE_OPERATIONS.create_thread,
        {
          type: input.type,
          host: { kind: 'sandbox', id: input.id },
          title: input.title,
        },
        lens(at, { project: input.project }),
      ),
    ).pipe(Effect.map((created) => ({ id: created.snapshot.thread.id, thread: created.snapshot.thread }))),
};
