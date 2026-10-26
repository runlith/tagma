import { Context, type Effect, type Scope } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { World } from '@runlith/agent-tools/world';
import type { WorldHost } from '../../../executions/contract/service/worlds.js';
import type { BoundThread, SandboxUnavailable } from './sandboxes.js';

export type SandboxWorld = {
  readonly world: World;
  readonly root: string;
  readonly scratch: string;
  readonly alive: () => boolean;
};

export class GuestWorlds extends Context.Service<
  GuestWorlds,
  {
    readonly world: (thread: BoundThread) => Effect.Effect<SandboxWorld, SandboxUnavailable | ThreadStorageFailed, Scope.Scope>;
    readonly worldHost: () => WorldHost;
  }
>()('tagma/sandbox/GuestWorlds') {}
