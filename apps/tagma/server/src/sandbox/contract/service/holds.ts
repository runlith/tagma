import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { Context, type Effect } from 'effect';
import type { Unit } from '../../../platform/contract/service/units.js';

export class SandboxHolds extends Context.Service<
  SandboxHolds,
  {
    hold(sandbox: string, threadId: string, tx: Unit<'machine'>): Effect.Effect<void, ThreadStorageFailed>;
  }
>()('tagma/sandbox/SandboxHolds') {}
