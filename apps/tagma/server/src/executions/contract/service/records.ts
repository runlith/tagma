import type { LoadSubscription } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ListenerReport, ProcessReport } from '@runlith/executions/protocol/evidence';
import type { ForegroundAnswer } from '@runlith/executions/protocol/terminal';
import type {
  FrameRevision,
  ScreenAnswer,
  ScreenPointed,
  ScreenPointRead,
  ScreenRead,
  ScreenFeedItem,
} from '@runlith/executions/protocol/presentation';
import type { ByteCursor, RecordRange, StreamPositions } from '@runlith/executions/protocol/record';
import type { RecordChunk } from '../wire/viewLeases.js';
import type { TerminalFailure } from './terminals.js';

export type BytesOptions = {
  readonly withPositions?: boolean;
};

export class ExecutionRecords extends Context.Service<
  ExecutionRecords,
  {
    readonly bytes: (
      cursor: ByteCursor,
      limit: number,
      options?: BytesOptions,
    ) => Effect.Effect<{ readonly range: RecordRange; readonly positions?: StreamPositions; readonly bytes: Uint8Array }, TerminalFailure>;
    readonly records: (cursor: ByteCursor) => Stream.Stream<RecordChunk, TerminalFailure>;
  }
>()('tagma/executions/ExecutionRecords') {}

export class TerminalScreens extends Context.Service<
  TerminalScreens,
  {
    readonly screen: (execution: ExecutionRef, request?: ScreenRead) => Effect.Effect<ScreenAnswer, TerminalFailure>;
    readonly point: (execution: ExecutionRef, request: ScreenPointRead) => Effect.Effect<ScreenPointed, TerminalFailure>;
    readonly screens: (execution: ExecutionRef, base?: FrameRevision) => Stream.Stream<ScreenFeedItem, TerminalFailure>;
  }
>()('tagma/executions/TerminalScreens') {}

export class ExecutionProcessEvidence extends Context.Service<
  ExecutionProcessEvidence,
  {
    readonly foreground: (execution: ExecutionRef) => Effect.Effect<ForegroundAnswer, TerminalFailure>;
    readonly processes: (execution: ExecutionRef) => Effect.Effect<ProcessReport | undefined, TerminalFailure>;
    readonly ports: (execution: ExecutionRef) => Effect.Effect<ListenerReport | undefined, TerminalFailure>;
    readonly load: (serverPid: number, desktopPid?: number) => Effect.Effect<LoadSubscription, ExecutionsFailure, Scope.Scope>;
  }
>()('tagma/executions/ExecutionProcessEvidence') {}
