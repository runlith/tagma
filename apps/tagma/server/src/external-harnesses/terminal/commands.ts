import { Effect } from 'effect';
import { commandWitness, type WitnessedCommand } from '@runlith/agent-tools/bash/witnessed';
import { ChangeRecord } from '../../change-record/contract/service/record.js';
import { MachineWorld } from '../../executions/contract/service/worlds.js';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import { FileWatcher } from '../../platform/contract/service/watch.js';
import { watchedChanges } from '../../platform/watch/changeSource.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { HarnessShell } from '../../threads/contract/wire/harness/observation.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';

export type TerminalCommands = {
  readonly opened: (threadId: string, callId: string, shell: HarnessShell) => Effect.Effect<void>;
  readonly settled: (threadId: string, callId: string) => Effect.Effect<void>;
  readonly ended: (threadId: string) => Effect.Effect<void>;
};

type Witnessing = { readonly threadId: string; readonly command: WitnessedCommand | null };

export const makeTerminalCommands = Effect.gen(function* () {
  const record = yield* ChangeRecord;
  const paths = yield* CheckoutPaths;
  const records = yield* ThreadRecords;
  const watcher = yield* Effect.serviceOption(FileWatcher);
  const witness = commandWitness({
    world: (yield* MachineWorld).world,
    unowned: [CHECKOUT_DIRECTORY],
    source: watcher._tag === 'Some' ? yield* watchedChanges(watcher.value) : null,
  });
  const standing = new Map<string, Witnessing>();
  const keyOf = (threadId: string, callId: string) => `${threadId}\0${callId}`;

  const witnessed = Effect.fnUntraced(function* (threadId: string, shell: HarnessShell) {
    const projectId = yield* records.projectOf(threadId);
    const place = projectId === undefined ? null : yield* paths.placeAcross(shell.cwd);
    if (projectId === undefined || place === null) return null;
    return yield* witness({
      cwd: place.root,
      changes: record.changes({ work: { projectId, threadId } }),
      command: shell.command,
      workdir: shell.cwd,
    });
  });

  const settle = (key: string): Effect.Effect<void> => {
    const held = standing.get(key);
    if (held?.command == null) return Effect.void;
    standing.delete(key);
    return held.command.settle;
  };

  return {
    opened: Effect.fn('TerminalCommands.opened')(function* (threadId, callId, shell) {
      const key = keyOf(threadId, callId);
      if (standing.has(key)) return;
      standing.set(key, { threadId, command: null });
      const command = yield* witnessed(threadId, shell).pipe(
        Effect.catchTags({
          PlaceUnread: (unread) => unmeasured(threadId, callId, unread.reason),
          EffectDrizzleQueryError: (failed) => unmeasured(threadId, callId, failed.message),
          SqlError: (failed) => unmeasured(threadId, callId, failed.message),
          PlatformError: (failed) => unmeasured(threadId, callId, failed.message),
          WorkspaceRefused: (refused) => unmeasured(threadId, callId, refused.message),
        }),
      );
      if (command === null) standing.delete(key);
      else standing.set(key, { threadId, command });
    }),
    settled: (threadId, callId) => settle(keyOf(threadId, callId)).pipe(Effect.withSpan('TerminalCommands.settled')),
    ended: (threadId) =>
      Effect.forEach(
        [...standing].flatMap(([key, held]) => (held.threadId === threadId ? [key] : [])),
        settle,
        { discard: true },
      ).pipe(Effect.withSpan('TerminalCommands.ended')),
  } satisfies TerminalCommands;
});

const unmeasured = (threadId: string, callId: string, reason: string) =>
  Effect.as(Effect.logWarning("a CLI's shell call was not measured, so what it writes stays nobody's", { threadId, callId, reason }), null);
