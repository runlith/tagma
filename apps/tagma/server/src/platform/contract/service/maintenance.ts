import { Context, Effect } from 'effect';
import { drive } from './drives.js';

export class Maintenance extends Context.Service<
  Maintenance,
  { readonly opened: Effect.Effect<void>; readonly isOpen: Effect.Effect<boolean> }
>()('tagma/platform/Maintenance') {}

export type StandingSweep = (moment: string) => Effect.Effect<void>;

export const scheduleSweeps = Effect.fnUntraced(function* (id: string, sweeps: readonly StandingSweep[]) {
  const { opened } = yield* Maintenance;
  const all = (moment: string) => Effect.forEach(sweeps, (sweep) => sweep(moment), { discard: true });
  yield* drive(
    id,
    opened.pipe(
      Effect.andThen(all('startup')),
      Effect.andThen(Effect.forever(Effect.sleep('24 hours').pipe(Effect.andThen(all('scheduled'))))),
    ),
  );
});
