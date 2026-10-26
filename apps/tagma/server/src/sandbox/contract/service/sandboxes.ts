import { Context, Data, type Effect } from 'effect';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadBirthCarried, ThreadRow } from '@runlith/agent/thread/rows';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { SandboxExport, SandboxPreparation, SandboxReconciliation, SandboxRecord } from '../wire/sandbox.js';

export class SandboxUnavailable extends Data.TaggedError('SandboxUnavailable')<{
  readonly sandbox: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `sandbox-unavailable: ${this.sandbox} — ${this.reason}`;
  }
}

export class SandboxBindingConflict extends Data.TaggedError('SandboxBindingConflict')<{
  readonly sandbox: string;
  readonly holder: string;
}> {
  override get message(): string {
    return `sandbox-taken: ${this.sandbox} is bound to thread ${this.holder}; a sandbox holds one thread and no more.`;
  }
}

export class SandboxHeldConflict extends Data.TaggedError('SandboxHeldConflict')<{
  readonly sandbox: string;
  readonly holder: string;
}> {
  override get message(): string {
    return `sandbox-busy: ${this.sandbox} is held by ${this.holder}; it releases once that hold is gone.`;
  }
}

export class SandboxReadConflict extends Data.TaggedError('SandboxReadConflict')<{
  readonly sandbox: string;
  readonly readers: number;
}> {
  override get message(): string {
    return `sandbox-reading: ${this.sandbox} is being imported from by ${this.readers} call${this.readers === 1 ? '' : 's'}; its release resumes when they are done.`;
  }
}

export type BoundThread = Pick<ThreadRow, 'id' | 'hostKind' | 'hostId'>;

export class Sandboxes extends Context.Service<
  Sandboxes,
  {
    readonly prepare: (
      request: SandboxPreparation & { readonly ownerId: string },
    ) => Effect.Effect<SandboxRecord, SandboxUnavailable | ThreadStorageFailed>;
    readonly byId: (id: string) => Effect.Effect<SandboxRecord | null, ThreadStorageFailed>;
    readonly ofThread: (threadId: string) => Effect.Effect<SandboxRecord | null, ThreadStorageFailed>;
    readonly records: () => Effect.Effect<readonly SandboxRecord[], ThreadStorageFailed>;
    readonly admit: (
      input: {
        readonly host: { readonly kind: string; readonly id: string };
        readonly child: ThreadRow;
        readonly projectId: number | undefined;
        readonly carried: ThreadBirthCarried;
      },
      tx: WriteUnit<'machine'>,
    ) => Effect.Effect<void, ThreadBorderFailed>;
    readonly ready: (thread: BoundThread) => Effect.Effect<void, ThreadBorderFailed>;
    readonly acquire: (thread: BoundThread) => Effect.Effect<SandboxRecord, SandboxUnavailable | ThreadStorageFailed>;
    readonly release: (
      id: string,
    ) => Effect.Effect<SandboxExport, SandboxUnavailable | SandboxHeldConflict | SandboxReadConflict | ThreadStorageFailed>;
    readonly discard: (id: string, tx: WriteUnit<'machine'>) => Effect.Effect<void, ThreadBorderFailed>;
    readonly cleanup: (ids?: readonly string[]) => Effect.Effect<readonly string[], ThreadStorageFailed>;
    readonly condemnUnfinished: () => Effect.Effect<readonly string[], ThreadStorageFailed>;
    readonly reconcile: () => Effect.Effect<SandboxReconciliation, ThreadStorageFailed>;
  }
>()('tagma/sandbox/Sandboxes') {}
