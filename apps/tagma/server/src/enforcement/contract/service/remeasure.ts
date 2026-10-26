import { Context, type Effect } from 'effect';
import type { AfterDelivery, EscapeNotice, FileSubject, HeadSubject, LandedTree } from '../wire/checks.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type JournaledLanding = LandedTree & { readonly op: string };

export type JournalPosition = { readonly at: Date; readonly key: string };

export type JournalRow = {
  readonly key: string;
  readonly at: Date;
  readonly landing: JournaledLanding | null;
  readonly parked: string | null;
};

export type LandingEntry = { readonly key: string; readonly landing: JournaledLanding; readonly payload: string };

export type LandingJournal = {
  readonly put: (entry: LandingEntry) => Effect.Effect<void, StoreFailure>;
  readonly remove: (key: string) => Effect.Effect<void, StoreFailure>;
  readonly park: (key: string, reason: string) => Effect.Effect<void, StoreFailure>;
  readonly page: (after: JournalPosition | null, limit: number) => Effect.Effect<readonly JournalRow[], StoreFailure>;
};

export type EscapeTell = (notice: EscapeNotice) => Effect.Effect<{ readonly _tag: string }>;

export class Remeasure extends Context.Service<
  Remeasure,
  {
    opened(projectId: number, root: string): void;
    closed(projectId: number, root: string): void;
    ready(projectId: number, root: string | null): Effect.Effect<void, GateRefusal<'inspection-failed'>>;
    landed(op: string, landed: LandedTree): Effect.Effect<AfterDelivery | void>;
    checked(op: string, subject: FileSubject | HeadSubject): Effect.Effect<void>;
    enforced(at: { readonly projectId: number; readonly root: string | null; readonly rule: string }): Effect.Effect<void>;
    telling(tell: EscapeTell): () => void;
    tell(notice: EscapeNotice): Effect.Effect<void>;
  }
>()('tagma/enforcement/Remeasure') {}
