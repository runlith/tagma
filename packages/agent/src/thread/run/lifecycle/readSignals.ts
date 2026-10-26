import { Effect } from 'effect';
import { signalEntryId } from '../../../transcript/entryNames';
import type { ThreadSignalEntry } from '../../../transcript/entries';
import { entryOf } from '../../../transcript/kinds';
import { threadEntryEvent, threadSignalEvent, type ThreadEventBody } from '../../events';
import { carriesWords, opensTurn, threadSignalOfInboxItem } from '../../inboxItems';
import { actDigest, reportKey } from '../../keyed';
import { sealThreadEvents } from '../../ThreadEventDoor';
import type { ThreadAttachments, ThreadInbox, ThreadStore, ThreadWriteTx } from '../../ThreadPorts';
import { answerOf, prepareTransition, type transitionDeps, transitionIn } from '../../transition/kernel';
import type { ThreadRunRef } from '../ThreadRunLedger';

type WordsKept = 'read' | 'unconfirmed';

const isSignal = entryOf('signal');

const confirmed = ({ unconfirmed, ...entry }: ThreadSignalEntry): ThreadSignalEntry => entry;

export const readSignals = (
  kernel: Effect.Success<typeof transitionDeps>,
  store: ThreadStore['Service'],
  inbox: ThreadInbox['Service'],
  attachments: ThreadAttachments['Service'],
  ownerId: string,
) =>
  Effect.fnUntraced(function* (run: ThreadRunRef, items: readonly string[], kept: WordsKept, tx: ThreadWriteTx) {
    const signals: ThreadEventBody[] = [];
    for (const id of items) {
      const item = yield* inbox.receipt(id, tx);
      if (item === undefined || item.threadId !== run.threadId || item.state === 'acknowledged' || !carriesWords(item)) continue;
      const signal = threadSignalOfInboxItem(item);
      const standing = yield* store.entryById(run.threadId, signalEntryId(signal.id), tx);
      if (standing !== undefined) {
        if (!isSignal(standing) || (standing.unconfirmed === true) === (kept === 'unconfirmed')) continue;
        signals.push(threadEntryEvent(kept === 'unconfirmed' ? { ...standing, unconfirmed: true } : confirmed(standing)));
        continue;
      }
      if (opensTurn(item)) continue;
      const stored = signal.attachments?.length ? yield* attachments.resolve(run.threadId, ownerId, signal.attachments) : [];
      signals.push(
        threadSignalEvent(signal, run.id, {
          attachments: stored.length === 0 ? undefined : stored,
          unconfirmed: kept === 'unconfirmed' || undefined,
        }),
      );
    }
    if (signals.length === 0) return;
    const prepared = yield* prepareTransition(kernel, run.threadId, sealThreadEvents(signals), tx);
    const outcome = yield* transitionIn(
      kernel,
      tx,
      prepared,
      { declared: prepared.declared, decide: () => Effect.succeed({ apply: true, result: 'applied' as const }) },
      {
        evidence: { call: reportKey(run.id, `${kept}:${items.join(',')}`) },
        digest: actDigest([kept, prepared.declared.map((event) => event.body)]),
      },
    );
    yield* answerOf(run.threadId, outcome);
  });
