import { Effect } from 'effect';
import type { ThreadEventDelta } from '../transcript/eventFold';
import { transcriptFact } from './ThreadEventDoor';
import type { ThreadPortFailure } from './ThreadBorder';
import type { ThreadEventLogStorage } from './storage/eventLog';
import type { ThreadEntryReader } from '../transcript/kinds';

const WIRE_DELTA_CAP = 1_000;
const WIRE_DELTA_PAGE = WIRE_DELTA_CAP / 5;

export const threadWireDeltas = Effect.fnUntraced(function* <TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  afterPosition: number,
  tx?: TTx,
): Effect.fn.Return<readonly ThreadEventDelta[] | null, ThreadPortFailure> {
  const head = yield* log.headPosition(threadId, tx);
  if (head - afterPosition > WIRE_DELTA_CAP) return null;
  const deltas: ThreadEventDelta[] = [];
  let cursor = afterPosition;
  for (;;) {
    const page = yield* log.eventsAfter(threadId, cursor, WIRE_DELTA_PAGE, tx);
    for (const record of page) deltas.push({ position: record.position, ...transcriptFact(kinds, record.kind, record.id, record.payload) });
    if (page.length < WIRE_DELTA_PAGE) return deltas;
    cursor = page[page.length - 1]?.position ?? cursor;
  }
});
