import { Clock, Effect } from 'effect';
import { AGENT_CHILD_UPDATE_SIGNAL_TYPE } from '@runlith/agent/contracts';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { Actor } from '../../platform/contract/wire/actor.js';
import { sessionToken } from '../../platform/contract/wire/session.js';
import { ThreadDeletions } from '../contract/service/deletions.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import type { ThreadSummary } from '../list/summary.js';
import type { ThreadInbox } from '../store/inbox.js';
import type { DeletionRecords } from '../store/deletions.js';
import { deletedLineKey, stateLines, type EventLines } from '../subscriptions/delivery.js';

type ThreadDeletionsInput = {
  readonly threads: ThreadLookup['Service'];
  readonly inbox: ThreadInbox['Service'];
  readonly records: DeletionRecords;
  readonly lines: EventLines;
};

type Ended = { readonly run: boolean; readonly owed: boolean };

const byWord = (by: Actor): string =>
  by.kind === 'operator'
    ? 'the operator'
    : by.kind === 'thread'
      ? `thread ${by.threadId}`
      : by.kind === 'session'
        ? `session ${sessionToken(by.session)}`
        : by.name;

const deletedLine = (child: ThreadSummary, by: string, at: string, ended: Ended): string =>
  [
    `${child.name ?? child.id} was deleted by ${by} at ${at}.`,
    ...(ended.run ? ['Its running turn was stopped.'] : []),
    ...(ended.owed ? ['The report it owed you will not come.'] : []),
    'No act reaches it any more; spawn a fresh agent briefed with its last report for the work it was doing.',
  ].join(' ');

export const makeThreadDeletions = ({ threads, inbox, records, lines }: ThreadDeletionsInput) =>
  ThreadDeletions.of({
    deleting: Effect.fn('ThreadDeletions.deleting')(
      function* (tree, running, by) {
        const at = new Date(yield* Clock.currentTimeMillis);
        const word = byWord(by);
        const members = yield* threads.summaries(tree);
        yield* records.record(
          members.map((member) => ({
            threadId: member.id,
            ownerId: member.ownerId,
            spawnRootId: member.spawnRootId,
            name: member.name,
            by: word,
            deletedAt: at,
          })),
        );
        const leaving = new Set(tree);
        const told: { readonly recipient: string; readonly child: ThreadSummary; readonly ended: Ended }[] = [];
        for (const member of members) {
          const owed = new Set(
            (yield* inbox.openRequests(member.id)).flatMap((request) =>
              request.sender.kind === 'thread' ? [request.sender.threadId] : [],
            ),
          );
          const addressed = new Set([...(member.parentThreadId === null ? [] : [member.parentThreadId]), ...owed]);
          for (const recipient of addressed) {
            if (!leaving.has(recipient))
              told.push({ recipient, child: member, ended: { run: running.has(member.id), owed: owed.has(recipient) } });
          }
        }
        const standing = new Set((yield* threads.summaries([...new Set(told.map((line) => line.recipient))])).map((thread) => thread.id));
        const stamp = at.toISOString();
        return Effect.forEach(
          told.filter((line) => standing.has(line.recipient)),
          ({ recipient, child, ended }) =>
            lines({
              subscriberId: recipient,
              about: child.id,
              type: AGENT_CHILD_UPDATE_SIGNAL_TYPE,
              key: deletedLineKey(recipient),
              text: deletedLine(child, word, stamp, ended),
              notice: {
                kind: 'child-update',
                child: { threadId: child.id, projectId: child.projectId, name: child.name },
                event: 'deleted',
                by: word,
                at: stamp,
                ended,
                forOperator: false,
                cost: { kind: 'unknown', tokens: null },
              },
              wakes: false,
              replaces: [...stateLines(child.id), `${AGENT_CHILD_UPDATE_SIGNAL_TYPE}:${child.id}:model-changed:`],
            }),
          { discard: true },
        ).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
      },
      Effect.mapError((cause) => (cause instanceof ThreadCallBroke ? cause : new ThreadCallBroke({ cause }))),
    ),
  });
