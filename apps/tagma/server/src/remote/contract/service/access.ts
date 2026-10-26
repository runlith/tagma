import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { AccessState } from '../wire/access.js';
import type { Listener } from './exposure.js';

export type AccessReading = {
  readonly enabled: boolean;
  readonly state: AccessState;
  readonly sandbox: AccessState;
  readonly sites: Readonly<Record<string, AccessState>>;
  readonly machine: string;
};

export class Access extends Context.Service<
  Access,
  {
    readonly read: Effect.Effect<AccessReading>;
    readonly parentOrigin: string | null;
    readonly sandboxOrigin: string | null;
    serve(listener: Listener): Effect.Effect<never, StoreFailure>;
  }
>()('tagma/remote/Access') {}
