import { Context, type Effect, type Stream } from 'effect';
import type { CommandExchange } from '@runlith/tagma/adapter/provider';
import type { EnvironmentEntry, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type AccountCommand = {
  readonly program: string;
  readonly args: readonly string[];
  readonly entries: readonly EnvironmentEntry[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly exchange?: CommandExchange;
  readonly located?: boolean;
};

export type AccountOutput = { readonly stdout: string; readonly stderr: string; readonly code: number };

export type ProgramState =
  | { readonly _tag: 'Found' }
  | { readonly _tag: 'Missing'; readonly reason: string }
  | { readonly _tag: 'Searching' };

export type LoginEnvironment = {
  readonly variables: Readonly<Record<string, string>>;
  readonly reading: boolean;
};

export class LoginPlaces extends Context.Service<
  LoginPlaces,
  {
    retain(names: readonly string[]): void;
    readonly now: Effect.Effect<LoginEnvironment>;
    readonly ready: Effect.Effect<LoginEnvironment>;
  }
>()('tagma/providers/LoginPlaces') {}

export class AccountCli extends Context.Service<
  AccountCli,
  {
    installed(program: string): Effect.Effect<ProgramState>;
    readonly changes: Stream.Stream<void>;
    run(command: AccountCommand): Effect.Effect<AccountOutput, GateRefusal>;
    login(command: AccountCommand, projectId: number): Effect.Effect<ExecutionRef, GateRefusal>;
    ended(login: ExecutionRef, projectId: number): Effect.Effect<void>;
    stop(login: ExecutionRef, projectId: number): Effect.Effect<void, GateRefusal>;
  }
>()('tagma/providers/AccountCli') {}
