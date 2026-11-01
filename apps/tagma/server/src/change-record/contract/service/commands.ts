import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export type CommandSelection = ({ readonly projectId: number } | { readonly checkout: string }) & {
  readonly threadId?: string;
  readonly paths?: readonly string[];
};

export const TEAM_REASON = 'team';
export const ABSENT_DIGEST = 'absent';

export type CommandSession = { readonly projectId: number; readonly threadId: string };

export type CommandUnattributed = {
  readonly projectId: number;
  readonly threadId: string;
  readonly checkout: string;
  readonly path: string;
  readonly reason: string;
  readonly team: string | null;
  readonly digest: string | null;
  readonly commandLine: string | null;
  readonly at: number;
};

export class CommandChanges extends Context.Service<
  CommandChanges,
  {
    settled(selection: CommandSelection): Effect.Effect<void, StoreFailure>;
    decided(session: CommandSession): Effect.Effect<number, StoreFailure>;
    unattributed(session: CommandSession): readonly CommandUnattributed[];
    retained(session: CommandSession, checkout: string): ReadonlyMap<string, CommandUnattributed>;
    unattributedUnder(checkout: string, place: string): readonly CommandUnattributed[];
  }
>()('tagma/change-record/CommandChanges') {}
