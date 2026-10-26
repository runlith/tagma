import { Cause, Context, Effect, type Scope } from 'effect';

export type Drive = Effect.Effect<unknown, unknown, Scope.Scope>;

export const watched = (id: string, pass: Drive): Effect.Effect<void, unknown, Scope.Scope> =>
  pass.pipe(
    Effect.asVoid,
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning(`the driver ${id} stopped`, Cause.pretty(cause)),
    ),
  );

export const Drives = Context.Reference<{ readonly offer: (id: string, drive: Drive) => Effect.Effect<void, never, Scope.Scope> }>(
  'tagma/platform/Drives',
  { defaultValue: () => ({ offer: (id, drive) => Effect.asVoid(Effect.forkScoped(watched(id, drive))) }) },
);

export const drive = (id: string, pass: Drive): Effect.Effect<void, never, Scope.Scope> =>
  Effect.flatMap(Drives, (drives) => drives.offer(id, pass));
