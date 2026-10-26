import { type Context, Effect, Scope } from 'effect';
import { type Drive, type Drives, watched } from '../platform/contract/service/drives.js';

type Offered = { readonly id: string; readonly drive: Drive; readonly scope: Scope.Scope; readonly context: Context.Context<never> };

const run = ({ id, drive, scope, context }: Offered) =>
  Effect.asVoid(
    Effect.forkIn(
      Effect.updateContext(Scope.provide(watched(id, drive), scope), (_: Context.Context<never>) => context),
      scope,
    ),
  );

export const makeDrives = (declared: ReadonlySet<string>, chosen: ReadonlySet<string> | undefined) => {
  let offered: Offered[] | null = [];
  const drives: Effect.Success<typeof Drives> = {
    offer: Effect.fnUntraced(function* (id: string, drive: Drive) {
      if (!declared.has(id))
        return yield* Effect.die(new Error(`the driver ${id} is offered by a module whose manifest does not declare it`));
      if (chosen !== undefined && !chosen.has(id)) return;
      const one = { id, drive, scope: yield* Effect.scope, context: yield* Effect.context<never>() };
      if (offered === null) yield* run(one);
      else offered.push(one);
    }),
  };
  const start = Effect.suspend(() => {
    const waiting = offered ?? [];
    offered = null;
    return Effect.forEach(waiting, run, { discard: true });
  });
  return { drives, start };
};
