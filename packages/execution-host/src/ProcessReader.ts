import { Data, Context, type Effect } from 'effect';
import type { DeclaredPart, ProcessWitness } from '@runlith/executions/protocol/evidence';

export type Field<A> = { readonly _tag: 'Read'; readonly value: A } | { readonly _tag: 'Unreadable'; readonly detail: string };

export type ProcessFacts = ProcessWitness & {
  readonly parent: number;
  readonly work: number;
  readonly args: Field<ReadonlyArray<string>>;
  readonly executable: Field<string>;
  readonly folder: Field<string>;
};

export type ProcessReading = {
  readonly processes: ReadonlyArray<ProcessFacts>;
  readonly unread: ReadonlyArray<
    { readonly pid: number; readonly _tag: 'Gone' } | { readonly pid: number; readonly _tag: 'Unreadable'; readonly detail: string }
  >;
};

export type ProcessRow = ProcessWitness & {
  readonly parent: number;
  readonly work: number;
  readonly zombie: boolean;
};

export type ProcessIdentity =
  | (ProcessRow & { readonly _tag: 'Read' })
  | { readonly _tag: 'Gone' }
  | { readonly _tag: 'Unreadable'; readonly detail: string };

export class ProcessesUnreadable extends Data.TaggedError('ProcessesUnreadable')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export type BirthOrder = (left: string, right: string) => number | ProcessesUnreadable;

export type ProcessProbe =
  | { readonly _tag: 'Pids'; readonly pids: ReadonlyArray<number> }
  | { readonly _tag: 'Terminal'; readonly terminal: string }
  | { readonly _tag: 'Table' };

export type ProcessReader = {
  readonly scan: (request: ProcessProbe) => Effect.Effect<ReadonlyArray<ProcessRow>, ProcessesUnreadable>;
  readonly table: Effect.Effect<ReadonlyArray<ProcessRow>, ProcessesUnreadable>;
  readonly members: (work: number) => Effect.Effect<ReadonlyArray<ProcessRow>, ProcessesUnreadable>;
  readonly facts: (pids: ReadonlyArray<number>) => Effect.Effect<ProcessReading, ProcessesUnreadable>;
  readonly identity: (pid: number) => ProcessIdentity;
  readonly resolve: (part: DeclaredPart) => ProcessWitness | 'different' | 'unknown';
  readonly compareBirth: BirthOrder;
  readonly bornBetween: (birth: string, fromMs: number, untilMs: number) => boolean | ProcessesUnreadable;
};

export class Processes extends Context.Service<Processes, ProcessReader>()('@runlith/execution-host/Processes') {}
