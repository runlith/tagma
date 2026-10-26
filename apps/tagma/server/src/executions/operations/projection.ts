import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { DeclaredAnswer, OperationDeclaration } from '../../platform/contract/wire/operation.js';
import { body, type Refused } from '../../platform/contract/service/body.js';
import type { Voice } from '../../platform/contract/service/presentation.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import { terminalRefusal } from '../terminals/refusal.js';

export type TerminalActFailure<D extends OperationDeclaration> = Refused<D> | TerminalFailure;

type Satisfied<D extends OperationDeclaration> = Omit<Extract<DeclaredAnswer<D['answer']>, { readonly status: 'ok' }>, 'status'>;

type TerminalImplementation<D extends OperationDeclaration, Prepared, RP, RE> = {
  readonly prepare?: (input: D['input']['Type'], caller: Caller) => Effect.Effect<Prepared, TerminalActFailure<D>, RP>;
  readonly execute: (
    input: D['input']['Type'],
    prepared: Prepared,
    caller: Caller,
  ) => Effect.Effect<Satisfied<D>, TerminalActFailure<D>, RE>;
  readonly voice?: Voice<DeclaredAnswer<D['answer']>, D['input']['Type'], RP | RE>;
};

export const projectTerminal = <A, E extends TerminalFailure | GateRefusal<string>, R>(work: Effect.Effect<A, E, R>) =>
  Effect.mapError(work, terminalRefusal);

export const terminalBody = <const D extends OperationDeclaration, Prepared = undefined, RP = never, RE = never>(
  declaration: D,
  implementation: TerminalImplementation<D, Prepared, RP, RE>,
) => {
  const { prepare, execute, voice } = implementation;
  return body<D, Prepared, RP | RE, Refused<D>>(declaration, {
    prepare:
      prepare === undefined
        ? undefined
        : (input: D['input']['Type'], caller: Caller) => projectTerminal(prepare(input, caller)) as Effect.Effect<Prepared, Refused<D>, RP>,
    execute: (input: D['input']['Type'], prepared: Prepared, caller: Caller) =>
      Effect.map(
        projectTerminal(execute(input, prepared, caller)) as Effect.Effect<Satisfied<D>, Refused<D>, RE>,
        (value) => ({ status: 'ok' as const, ...value }) as unknown as DeclaredAnswer<D['answer']>,
      ),
    voice: voice,
  } as never);
};
