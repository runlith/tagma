import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { ThreadRecapWriting } from '../contract/service/recapWriting.js';
import { RECAP_OPERATIONS as OPS } from '../contract/wire/operations/recap.js';
import { declaredRefusals } from '../refusalAnswers.js';

export const RECAP_PAIRS = {
  generate_thread_recap: pair(
    OPS.generate_thread_recap,
    body(OPS.generate_thread_recap, {
      execute: (input) =>
        declaredRefusals(OPS.generate_thread_recap)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const recap = yield* (yield* ThreadRecapWriting).generate(input.threadId, call.project.id);
            return { status: 'written' as const, threadId: input.threadId, recap };
          }),
        ),
    }),
  ),
};
