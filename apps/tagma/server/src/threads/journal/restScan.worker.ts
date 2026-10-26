/// <reference types="bun" />

import { Effect, Exit } from 'effect';
import { type RolloutRecord, recordVerdict, scanRollout } from './rolloutFile.js';
import type { RestScanAnswer, RestScanAsk, RestScanRead } from './restScan.js';
import { RolloutReads, totalledReads } from '../contract/service/rolloutReads.js';

declare const self: Worker;

type Recorded = { readonly checkpoints: Set<string>; readonly pruned: Set<string>; unreadable: boolean };

function recordInto(recorded: Recorded, record: RolloutRecord): void {
  if (recordVerdict(record).kind === 'unreadable') recorded.unreadable = true;
  if (record.row === undefined) return;
  if (record.kind === 'checkpoint' && typeof record.row.id === 'string') recorded.checkpoints.add(record.row.id);
  else if (record.kind === 'pruned' && typeof record.row.toolCallId === 'string') recorded.pruned.add(record.row.toolCallId);
  else if (record.kind === 'pruned-retired' && typeof record.row.toolCallId === 'string') {
    recorded.pruned.delete(record.row.toolCallId);
  }
}

async function answered(ask: RestScanAsk): Promise<RestScanAnswer> {
  const recorded: Recorded = { checkpoints: new Set(), pruned: new Set(), unreadable: false };
  const totals = totalledReads();
  const scanned = await Effect.runPromiseExit(
    scanRollout(ask.path, (item) => recordInto(recorded, item)).pipe(Effect.provideService(RolloutReads, totals.observe)),
  );
  const reads = totals.drain();
  if (reads.length > 0) self.postMessage({ id: ask.id, kind: 'read', reads } satisfies RestScanRead);
  if (Exit.isFailure(scanned)) return { id: ask.id, kind: 'unreadable' };
  return {
    id: ask.id,
    kind: 'scanned',
    bytes: scanned.value.bytes,
    torn: scanned.value.torn,
    unreadable: recorded.unreadable,
    checkpoints: [...recorded.checkpoints],
    pruned: [...recorded.pruned],
  };
}

self.addEventListener('message', (event: MessageEvent<RestScanAsk>) => {
  answered(event.data).then(
    (answer) => self.postMessage(answer),
    (cause: unknown) =>
      self.postMessage({ id: event.data.id, kind: 'failed', reason: cause instanceof Error ? cause.message : String(cause) }),
  );
});
