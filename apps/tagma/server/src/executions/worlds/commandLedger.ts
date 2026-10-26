import { randomUUID } from 'node:crypto';
import { Clock, Effect, Layer } from 'effect';
import type { FinishedCommand } from '@runlith/agent-tools/world';
import { PerformanceStore } from '@runlith/performance/PerformanceStore';
import { type PerformanceRecord, recordByteSize } from '@runlith/performance/store/records';
import type { CommandPayload } from '@runlith/performance/protocol/records';
import { CommandLedger, type LedgerKey } from '../contract/service/worlds.js';

export const commandLedgerLayer = (options: { readonly instanceId: string }) =>
  Layer.effect(
    CommandLedger,
    Effect.map(PerformanceStore, (store) =>
      CommandLedger.of({
        of: (subject) => ({
          finished: (command) =>
            Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.sync(() => write(store, options.instanceId, subject, command, now))),
        }),
      }),
    ),
  );

const write = (
  store: typeof PerformanceStore.Service,
  instanceId: string,
  subject: LedgerKey,
  command: FinishedCommand,
  wallTime: number,
): void => {
  const record: PerformanceRecord<'command', CommandPayload> = {
    id: randomUUID(),
    kind: 'command',
    instanceId,
    wallTime,
    monotonicStart: command.monotonicStart,
    monotonicEnd: command.monotonicEnd,
    payload: {
      class: command.class,
      substrate: subject.substrate,
      cost: command.cost,
      exit: command.exit,
      threadId: subject.threadId,
      projectId: subject.projectId,
    },
  };
  store.submit({ record, retentionKey: record.id, byteSize: recordByteSize(record) });
};
