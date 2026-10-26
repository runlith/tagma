import { it } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Cause, Effect, Exit } from 'effect';
import { WORKING_OPERATIONS } from '../../../workspace/contract/wire/repositoryReads.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { admitted, UndeclaredRefusal } from '../../../platform/contract/service/routed.js';

const declaration = WORKING_OPERATIONS.read_repositories;
const refused = (code: string) => Effect.exit(admitted(declaration)(Effect.fail(new GateRefusal(code, 'said', ['ask again']))));

describe('admitted', () => {
  it.effect('a declared refusal and a field refusal stay refusals', () =>
    Effect.gen(function* () {
      for (const code of ['repository-missing', 'bad-name']) {
        const exit = yield* refused(code);
        expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(true);
      }
    }),
  );

  it.effect('an unproven code the operation does not declare ends as an undeclared-refusal defect', () =>
    Effect.gen(function* () {
      const exit = yield* refused('worktree-unavailable');
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof UndeclaredRefusal).toBe(true);
    }),
  );
});
