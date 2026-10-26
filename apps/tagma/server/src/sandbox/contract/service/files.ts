import { Context, type Effect, type Scope } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { SandboxUnavailable } from './sandboxes.js';

export type SandboxFile = {
  readonly text: string;
  readonly guestPath: string;
  readonly stillness: string;
};

export type ThreadQuiet = {
  readonly quiet: boolean;
  readonly reason: string;
};

export class SandboxFiles extends Context.Service<
  SandboxFiles,
  {
    readonly read: (
      id: string,
      path: string,
      owner: { readonly ownerId: string; readonly projectId: number },
      quiet?: (threadId: string) => Effect.Effect<ThreadQuiet, SandboxUnavailable, Scope.Scope>,
    ) => Effect.Effect<SandboxFile, SandboxUnavailable | ThreadStorageFailed, Scope.Scope>;
  }
>()('tagma/sandbox/SandboxFiles') {}
