import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import { COMMAND_RESULT_SIGNAL } from '../../../executions/contract/wire/commands.js';
import { CALL_RESULT_SIGNAL } from '../wire/calls.js';

export const OWN_ENDINGS: ReadonlySet<string> = new Set([COMMAND_RESULT_SIGNAL, CALL_RESULT_SIGNAL]);

export class OwnWork extends Context.Service<
  OwnWork,
  {
    readonly owing: (threads?: readonly string[]) => Effect.Effect<readonly string[], StoreFailure>;
    readonly endings: ReadonlySet<string>;
  }
>()('tagma/threads/OwnWork') {}
