import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { OperationCallers } from '../../platform/contract/wire/operation.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { OperationCatalog } from '../contract/service/catalog.js';
import { externalRefusal } from '../contract/service/refusals.js';
import { admitRight } from '../../platform/contract/service/access.js';

export const admitCallers = (
  id: string,
  callers: OperationCallers,
  meaning: string,
  caller: Caller,
  external = false,
): Effect.Effect<void, GateRefusal> => {
  if (caller.actor.kind === 'external') return external ? Effect.void : Effect.fail(externalRefusal(id, meaning));
  if (callers === 'thread' && caller.actor.kind !== 'thread') {
    return Effect.fail(
      new GateRefusal(
        caller.actor.kind === 'operator' ? 'thread-required' : 'session-unproven',
        `${id} is a thread protocol operation: ${meaning}`,
        ['call it from the thread process with its session grant'],
      ),
    );
  }
  return callers !== 'operator' || caller.actor.kind !== 'thread'
    ? Effect.void
    : Effect.fail(
        new GateRefusal('operator-only', `${id} is the operator's operation: ${meaning}`, [
          'ask the operator to perform it: from the window, or with `tagma op` in a shell of their own',
        ]),
      );
};

const admitted = (named: string, caller: Caller, right: boolean): Effect.Effect<void, GateRefusal, OperationCatalog> =>
  Effect.flatMap(OperationCatalog, (catalog) => {
    const id = catalog.registry.named(named);
    if (id === null) return Effect.die(new Error(`No operation is registered as ${named}.`));
    const entry = catalog.registry.entry(id);
    const callers = admitCallers(id, entry.callers, entry.meaning, caller, entry.external !== undefined);
    return right ? Effect.andThen(callers, admitRight(id, entry.right, entry.effect === 'read' ? 'read' : 'write')) : callers;
  });

export const admitOperation = (named: string, caller: Caller): Effect.Effect<void, GateRefusal, OperationCatalog> =>
  admitted(named, caller, true);

export const admitCaller = (named: string, caller: Caller): Effect.Effect<void, GateRefusal, OperationCatalog> =>
  admitted(named, caller, false);
