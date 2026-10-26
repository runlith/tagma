import { Context, Data, type Effect } from 'effect';

export class CommitUnreadable extends Data.TaggedError('CommitUnreadable')<{
  readonly commit: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `commit-unresolved: ${this.commit} — ${this.reason}`;
  }
}

export class GuestPreparation extends Context.Service<
  GuestPreparation,
  {
    readonly commitOf: (projectId: number, name: string) => Effect.Effect<string, CommitUnreadable>;
  }
>()('tagma/sandbox/GuestPreparation') {}
