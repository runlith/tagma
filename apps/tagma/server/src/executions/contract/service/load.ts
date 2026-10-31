import type { DeclaredPart, LoadInterest } from '@runlith/executions/protocol/evidence';
import { Context, type Effect, type Stream } from 'effect';
import type { LoadReader, MachineLoadFrame, WindowDeclaration, WindowProcess } from '../wire/load.js';
import type { TerminalFailure } from './terminals.js';

export class LoadFeed extends Context.Service<
  LoadFeed,
  {
    readonly machine: () => Stream.Stream<MachineLoadFrame, TerminalFailure>;
    readonly interest: (reader: LoadReader, demand: LoadInterest) => Effect.Effect<boolean>;
  }
>()('tagma/executions/LoadFeed') {}

export type WindowPart = { readonly host: string; readonly process: WindowProcess };

export class WindowDeclarations extends Context.Service<
  WindowDeclarations,
  {
    readonly declare: (host: string, generation: number, declaration: WindowDeclaration) => Effect.Effect<void>;
    readonly end: (host: string, generation: number) => Effect.Effect<void>;
    readonly parts: Stream.Stream<readonly DeclaredPart[]>;
    readonly declared: Effect.Effect<readonly DeclaredPart[]>;
    readonly part: (key: string) => WindowPart | undefined;
  }
>()('tagma/executions/WindowDeclarations') {}
