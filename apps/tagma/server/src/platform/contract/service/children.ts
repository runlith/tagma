import { Context } from 'effect';
import type { ProcessIdentity, ProcessReader } from '@runlith/execution-host/ProcessReader';
import type { ChildRole } from '../wire/children.js';
import type { ThreadId } from '../wire/thread.js';

export type ChildDeclaration = {
  readonly pid: number;
  readonly role: ChildRole;
  readonly thread?: ThreadId;
};

export type SpawnedChild = ChildDeclaration & { readonly identity: ProcessIdentity };

export type ChildLedger = {
  record(child: ChildDeclaration): () => void;
  of(pid: number): SpawnedChild | undefined;
};

export function childLedger(reader: ProcessReader | undefined, unavailable = 'this world has no process reader'): ChildLedger {
  const held = new Map<number, SpawnedChild>();
  return {
    record: (declared) => {
      const identity = reader === undefined ? { _tag: 'Unreadable' as const, detail: unavailable } : reader.identity(declared.pid);
      const child: SpawnedChild = { ...declared, identity };
      held.set(child.pid, child);
      return () => {
        if (held.get(child.pid) === child) held.delete(child.pid);
      };
    },
    of: (pid) => held.get(pid),
  };
}

export const ChildLedger = Context.Reference<ChildLedger>('tagma/platform/ChildLedger', { defaultValue: () => childLedger(undefined) });
