import { Effect } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import { hostedToolEntryId } from '@runlith/agent/transcript/entryNames';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ProtocolJournal } from './journal.js';
import type { ProtocolLinks } from './links.js';

type Introduced = { readonly turn: string; readonly calls: Set<string>; readonly carried: boolean };

export class HostedIntroductions {
  private readonly standing = new Map<string, Introduced>();

  constructor(
    private readonly links: ProtocolLinks,
    private readonly journal: ProtocolJournal,
  ) {}

  introduced(threadId: string, callId: string): Effect.Effect<void, HarnessFailure> {
    return Effect.suspend(() => {
      const link = this.links.get(threadId);
      if (link === undefined || link.profile.hosts === null || link.row.turns.length === 0) return Effect.void;
      const standing = this.standing.get(threadId);
      if (standing === undefined || standing.calls.has(callId)) return Effect.void;
      const waiting = this.links
        .until(threadId, () => (this.known(threadId, callId) ? true : null))
        .pipe(
          Effect.catchTag('LinkEnded', () => Effect.void),
          Effect.asVoid,
        );
      if (!standing.carried) return waiting;
      return Effect.flatMap(this.journal.tool(threadId, hostedToolEntryId(standing.turn, callId)), (entry) => {
        if (entry === null || this.unsealed(threadId, callId)) return waiting;
        standing.calls.add(callId);
        return Effect.void;
      });
    });
  }

  opening(threadId: string, turn: string, carried: boolean): void {
    if (this.standing.get(threadId)?.turn === turn) return;
    this.standing.set(threadId, { turn, calls: new Set(), carried });
  }

  recorded(threadId: string, messages: readonly Message[], ended: boolean): void {
    const standing = this.standing.get(threadId);
    if (standing === undefined) return;
    for (const message of messages) for (const part of message.content) if (part.type === 'tool-call') standing.calls.add(part.id);
    if (ended) this.standing.delete(threadId);
  }

  private known(threadId: string, callId: string): boolean {
    const standing = this.standing.get(threadId);
    return standing === undefined || standing.calls.has(callId);
  }

  private unsealed(threadId: string, callId: string): boolean {
    const row = this.links.get(threadId)?.row;
    return row?.turns.some((turn) => turn.assistant.some((part) => part.type === 'tool-call' && part.id === callId)) ?? false;
  }
}
