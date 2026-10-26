import { Effect, Layer, Schema } from 'effect';
import { toolPage } from '../agent/ToolPage';
import { ToolFailed, Tool, callerThread } from '../agent/tool';
import type { ToolCatalog } from '../agent/ToolCatalog';
import { threadCauseOf } from '../thread/ThreadBorder';
import { ThreadResourceLedger, ThreadToolRegistry, type ThreadToolSource } from '../thread/ThreadPorts';
import { DeclaredResources } from './ResourcesConfig';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';

export const RESOURCES_SOURCE = 'resources';

const HELD_RESOURCES_TOOL = 'held_resources';

export const resourcesSource = (ledger: (typeof ThreadResourceLedger)['Service']): ThreadToolSource => ({
  id: RESOURCES_SOURCE,
  tools: heldResourceTools(ledger),
});

function heldResourceTools(ledger: typeof ThreadResourceLedger.Service): ToolCatalog {
  return {
    [HELD_RESOURCES_TOOL]: Tool.make({
      approval: ASKS_NEVER,
      exposure: 'deferred',
      description:
        'What this thread is holding: every durable thing recorded against it — its scratch, its ' +
        'rollout, the bytes its tools captured, and whatever else this host declares — with what ' +
        'each one is and when it was taken. They are released when the thread ends; nothing here ' +
        'lets one go.',
      parameters: Schema.Struct({}),
      display: () => ({ form: 'none' }),
      execute: (_input, call) =>
        Effect.flatMap(callerThread(call.caller), (thread) =>
          Effect.mapError(
            Effect.map(ledger.held(thread.threadId), (held) =>
              toolPage({
                rows: held.map((row) => ({ label: `${row.kind} ${row.id}`, facts: [row.detail, row.heldAt] })),
                total: held.length,
                order: 'by kind, then by what each one is called',
                empty: 'this thread holds nothing',
              }),
            ),
            (failure) => new ToolFailed({ reason: message(threadCauseOf(failure)) }),
          ),
        ),
    }),
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const resourcesToolSourcesLayer: Layer.Layer<never, never, DeclaredResources | ThreadToolRegistry | ThreadResourceLedger> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      if ((yield* DeclaredResources) === null) return;
      const registry = yield* ThreadToolRegistry;
      const ledger = yield* ThreadResourceLedger;
      yield* registry.hold({
        id: RESOURCES_SOURCE,
        owner: '@runlith/agent/resources',
        names: [HELD_RESOURCES_TOOL],
        offer: () => Effect.succeed(resourcesSource(ledger)),
      });
    }).pipe(Effect.orDie),
  );
