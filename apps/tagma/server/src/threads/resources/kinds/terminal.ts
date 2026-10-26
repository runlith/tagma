import { Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import type { Unit } from '../../../platform/contract/service/units.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { TerminalRefused } from '../../../executions/contract/wire/refusals.js';
import type { Custody } from '../../../executions/contract/service/custody.js';

export function terminalsKind(store: Custody['Service']): ThreadResourceKind<Unit<'machine'>> {
  return {
    kind: 'terminals',
    end: Effect.fnUntraced(
      function* (rows, tx) {
        const threadIds = rows.map((row) => ThreadId.make(row.id));
        const fences = yield* store.fencesOf(tx, threadIds);
        if (fences.length > 0) {
          return yield* refuse(
            new TerminalRefused({
              reason: 'stale',
              message: `These threads stand behind ${fences.length} terminal ${
                fences.length === 1 ? 'operation whose outcome' : 'operations whose outcomes'
              } nobody can attribute yet (${fences.map((key) => key.operationId).join(', ')}); read those operations before they end.`,
            }),
          );
        }
        const held = yield* store.heldBy(tx, threadIds);
        if (held.length > 0) {
          return yield* refuse(
            new TerminalRefused({
              reason: 'not-holder',
              message: `These threads hold ${held.length} managed ${held.length === 1 ? 'execution' : 'executions'} (${held
                .map((record) => `${record.execution.execution} held by ${record.heldBy}`)
                .join(', ')}); transfer their custody or stop them before they end.`,
            }),
          );
        }
      },
      Effect.mapError((cause) =>
        cause instanceof ThreadStorageFailed ? cause : new ThreadStorageFailed({ call: 'terminals.end', cause }),
      ),
    ),
    describe: (row) => ({
      kind: row.kind,
      id: row.id,
      detail: 'the managed executions this thread holds custody of, and the terminal operations fencing it',
      heldAt: row.heldAt.toISOString(),
    }),
  };
}

const refuse = (refusal: TerminalRefused): Effect.Effect<never, ThreadStorageFailed> =>
  new ThreadStorageFailed({ call: 'terminals.end', cause: refusal });
