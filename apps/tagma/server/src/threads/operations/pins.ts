import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { PinOffers, ThreadPins } from '../contract/service/pins.js';
import { PIN_OPERATIONS as OPS } from '../contract/wire/operations/pins.js';
import { declaredRefusals } from '../refusalAnswers.js';

export const PIN_PAIRS = {
  pin_view: pair(
    OPS.pin_view,
    body(OPS.pin_view, {
      execute: (input) =>
        declaredRefusals(OPS.pin_view)(
          Effect.gen(function* () {
            const { project } = yield* yield* CurrentProject;
            const { threadId, ...pin } = input;
            yield* (yield* PinOffers).require(pin.plugin, pin.view);
            yield* (yield* ThreadPins).pin(threadId, project.id, pin);
            return { status: 'pinned' as const, ...input };
          }),
        ),
    }),
  ),
  unpin_view: pair(
    OPS.unpin_view,
    body(OPS.unpin_view, {
      execute: (input) =>
        declaredRefusals(OPS.unpin_view)(
          Effect.gen(function* () {
            const { project } = yield* yield* CurrentProject;
            const { threadId, ...pin } = input;
            yield* (yield* ThreadPins).unpin(threadId, project.id, pin);
            return { status: 'unpinned' as const, ...input };
          }),
        ),
    }),
  ),
};
