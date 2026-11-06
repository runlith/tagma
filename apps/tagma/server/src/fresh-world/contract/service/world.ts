import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RefusalOf } from '../../../platform/contract/service/body.js';
import type { FRESH_OPERATIONS } from '../wire/operations.js';

export type Standing = {
  readonly root: string;
  readonly release: string | null;
  readonly running: boolean;
  readonly url: string;
};

export type Opening = { readonly over: boolean; readonly release: string | null; readonly from: string | null };

type Opened = Standing & { readonly started: boolean };

export type FreshRefusal = RefusalOf<(typeof FRESH_OPERATIONS)['open_fresh_world']>;

export class FreshWorld extends Context.Service<
  FreshWorld,
  {
    readonly open: (opening: Opening) => Effect.Effect<Opened, GateRefusal<FreshRefusal>>;
    readonly read: Effect.Effect<Standing, GateRefusal<'fresh-host'>>;
  }
>()('tagma/fresh-world/FreshWorld') {}
