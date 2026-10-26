import type { Effect } from 'effect';
import type { Invocation } from '../../platform/cli/verb.js';
import type { Source } from '../contract/wire/source.js';
import type { StartupState } from '../contract/wire/restart.js';

export type HealthAnswer = {
  readonly _tag: 'Health';
  readonly health: { readonly version: string; readonly database: string; readonly source: Source };
};

export type CutDoor = {
  readonly operations: {
    perform(request: {
      readonly params: { readonly id: 'prepare_downgrade' | 'restart_server' };
      readonly query: { readonly cwd?: string };
      readonly headers: Record<string, string | number | undefined>;
      readonly payload: unknown;
    }): Effect.Effect<unknown, unknown>;
  };
};

export type StayingHost = { readonly state: string; readonly holders: readonly number[]; readonly detail: string | null };

export type InstanceHosts = {
  readonly staying: (database: string) => Effect.Effect<readonly StayingHost[]>;
};

export type CutServer = {
  readonly baseUrl: (at: Invocation) => string;
  readonly healthOrNone: () => Effect.Effect<HealthAnswer | null>;
  readonly startup: () => Effect.Effect<StartupState>;
};

export type BuildServer = CutServer & {
  readonly ask: <A>(call: (door: CutDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
  readonly boundHere: (at: Invocation, address: string) => boolean;
};
