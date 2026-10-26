import { Context, type Effect } from 'effect';
import type { Actor } from '../../../platform/contract/wire/actor.js';
import type { HarnessTransport } from '../../../threads/contract/wire/harness/names.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export type TransportSwitched =
  | { readonly status: 'switched'; readonly transport: HarnessTransport; readonly unstarted: string | null }
  | { readonly status: 'unchanged'; readonly transport: HarnessTransport };

export class TransportSwitch extends Context.Service<
  TransportSwitch,
  {
    to(threadId: string, projectId: number, actor: Actor, transport: HarnessTransport): Effect.Effect<TransportSwitched, HarnessFailure>;
  }
>()('tagma/external-harnesses/TransportSwitch') {}
