import { Context, type Effect } from 'effect';
import type { ConversationCoverage, ConversationHit, ConversationTally, ConversationWindow } from '../wire/conversation.js';
import type { EvidenceAddress, EvidenceReader } from './evidence.js';
import type { HarnessFailure } from './failure.js';
import type { Reach } from '../../../projects/contract/wire/reach.js';

export type ConversationSearch = {
  readonly query: string;
  readonly scope: Reach;
  readonly since?: number;
  readonly before?: number;
  readonly threadId?: string;
  readonly limit: number;
  readonly cursor?: string;
};

export type ConversationPage = {
  readonly matches: readonly ConversationHit[];
  readonly tally: ConversationTally;
  readonly coverage: ConversationCoverage;
  readonly excluded: string | null;
  readonly cursor: string | null;
  readonly cut: 'match-limit' | null;
  readonly approximate: boolean;
};

export type ConversationWindowRequest = {
  readonly addresses: readonly EvidenceAddress[];
  readonly around: number;
};

export class Conversations extends Context.Service<
  Conversations,
  {
    search(reader: EvidenceReader, request: ConversationSearch): Effect.Effect<ConversationPage, HarnessFailure>;
    window(projectId: number, request: ConversationWindowRequest): Effect.Effect<readonly ConversationWindow[], HarnessFailure>;
  }
>()('tagma/threads/Conversations') {}
