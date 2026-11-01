import { Effect, type Context, type FileSystem } from 'effect';
import type { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import type { ChangeCheckout, ChangeRecord } from '../../change-record/contract/service/record.js';
import type { Reshaped, ReshapeHolder } from '../../change-record/contract/wire/reshape.js';
import { applyCarried, readDelta, steppedDelta } from './reshaping.js';

const UNHELD: ReshapeHolder = { _tag: 'unheld' };

export type Forming = (reshaped: readonly Reshaped[]) => Effect.Effect<Effect.Effect<void>>;

export const formingOver = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  carrying: Context.Context<FileSystem.FileSystem | LineWrites>,
): Forming => {
  const apply = (reshaped: readonly Reshaped[]) =>
    Effect.provide(
      Effect.flatMap(readDelta(changes, checkout, steppedDelta(reshaped)), (carried) =>
        Effect.map(applyCarried(changes, checkout, carried, UNHELD), (edits) => ({ carried, edits })),
      ),
      carrying,
    );
  const withdraw = (reshaped: readonly Reshaped[]) =>
    Effect.flatMap(Effect.result(apply(reshaped)), (done) =>
      done._tag === 'Success'
        ? Effect.void
        : Effect.logWarning('the form the commit steps gave the working files was not withdrawn after the rules judged it', {
            root: checkout.root,
            reason: done.failure.message,
          }),
    );
  return Effect.fn('submitWork.form')(function* (reshaped) {
    const content = reshaped.filter((one) => one.before !== one.after).map(({ path, before, after }) => ({ path, before, after }));
    if (content.length === 0) return Effect.void;
    const wrote = yield* Effect.result(apply(content));
    if (wrote._tag === 'Failure') {
      yield* Effect.logWarning('the form the commit steps gave the working files did not reach them before the rules judged it', {
        root: checkout.root,
        reason: wrote.failure.message,
      });
      return Effect.void;
    }
    const { carried, edits } = wrote.success;
    const written = new Set(edits.edited);
    const back = carried.inputs.flatMap((one) =>
      one.read.kind === 'text' && one.read.disk !== one.read.after && written.has(one.path)
        ? [{ path: one.path, before: one.after, after: one.before }]
        : [],
    );
    return back.length === 0 ? Effect.void : withdraw(back);
  });
};
