import { Clock, Effect } from 'effect';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';
import type { InterruptReceipt } from '@runlith/agent/thread/transport/contract';
import type { NativeStorage } from '../../threads/contract/service/engine.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { ProtocolAttendance } from './attendance.js';
import type { ProtocolLaunches } from './launches.js';
import { facetOf, type Link, type ProtocolLinks } from './links.js';
import type { ProtocolRow } from './row.js';
import type { ProtocolSteps } from './steps.js';

export class ProtocolCancels {
  constructor(
    private readonly links: ProtocolLinks,
    private readonly launches: ProtocolLaunches,
    private readonly attendance: ProtocolAttendance,
    private readonly steps: ProtocolSteps,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly runs: NativeStorage['Service']['runs'],
    private readonly ownerId: string,
  ) {}

  readonly interrupt = Effect.fnUntraced(function* (this: ProtocolCancels, runId: string, by: ThreadRunStoppedBy | null) {
    const { links, launches, attendance } = this;
    const threadId = links.threadOf(runId) ?? launches.threadOf(runId) ?? (yield* this.standing(runId));
    if (threadId === undefined) return 'no-turn' as InterruptReceipt;
    if (launches.unsend(runId)) return yield* this.unsent(threadId, runId, by);
    if (launches.issuing(runId))
      yield* links
        .until(threadId, (current) => (current === undefined || !launches.issuing(runId) ? true : null))
        .pipe(Effect.catchTag('LinkEnded', () => Effect.void));
    const link = links.get(threadId) ?? (yield* attendance.connect(threadId));
    return link === null ? ('no-turn' as InterruptReceipt) : yield* this.cancel(link, runId, by);
  });

  private readonly unsent = Effect.fnUntraced(function* (
    this: ProtocolCancels,
    threadId: string,
    runId: string,
    by: ThreadRunStoppedBy | null,
  ) {
    const { store, steps } = this;
    const facet = yield* facetOf(store, threadId);
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* steps.close(threadId, facet.name, { turn: runId, at, status: 'aborted', failure: null, stoppedBy: by ?? 'reader' });
    return 'interrupted' as InterruptReceipt;
  });

  private readonly cancel = Effect.fnUntraced(function* (this: ProtocolCancels, link: Link, runId: string, by: ThreadRunStoppedBy | null) {
    const key = link.facet.sessionKey;
    if (key === null || !vendorTurnOpen(link.row, runId)) return 'no-turn' as InterruptReceipt;
    const cancel = link.writer.cancel({ sessionId: key }, [runId], by);
    return yield* this.links
      .until(link.threadId, (current): InterruptReceipt | null =>
        current !== link ? 'no-turn' : cancel.written?._tag === 'Admitted' ? 'interrupted' : null,
      )
      .pipe(Effect.catchTag('LinkEnded', () => Effect.succeed<InterruptReceipt>('no-turn')));
  });

  private readonly standing = Effect.fnUntraced(function* (this: ProtocolCancels, runId: string) {
    const run = yield* this.runs(this.ownerId).runById(runId);
    if (run === null) return undefined;
    const row = yield* this.rows.load(run.threadId);
    return row !== null && vendorTurnOpen(row, runId) ? run.threadId : undefined;
  });
}

const vendorTurnOpen = (row: ProtocolRow, runId: string): boolean =>
  row.turns.some((turn) => turn.id === runId) ||
  row.compact?.turn === runId ||
  row.client.requests.some((request) => request.meaning === 'prompt' && request.cancelled && request.turn === runId);
