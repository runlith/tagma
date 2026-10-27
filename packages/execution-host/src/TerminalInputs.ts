import { Context, Effect, type Scope } from 'effect';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { TerminalGeometry } from '@runlith/executions/protocol/record';
import {
  InputActUnsupported,
  InputWriteFailed,
  makeExecutionInput,
  type ExecutionInput,
  type InputCarry,
  type InputSink,
} from './ExecutionInput';
import type { ChannelFailed, Terminal } from './holder/Holder';

export type TerminalInputOptions = {
  readonly limits: ExecutionLimits;
  readonly ref: ExecutionRef;
  readonly announce: Effect.Effect<void>;
  readonly carried?: InputCarry;
  readonly end: () => Effect.Effect<void, InputWriteFailed>;
  readonly resized: (geometry: TerminalGeometry) => Effect.Effect<void, InputActUnsupported>;
};

export type TerminalInputs = {
  readonly open: (terminal: Terminal, options: TerminalInputOptions) => Effect.Effect<ExecutionInput, never, Scope.Scope>;
};

export const TerminalInputs = Context.Reference<TerminalInputs>('@runlith/execution-host/TerminalInputs', {
  defaultValue: () => ({
    open: (terminal, { limits, ref, announce, carried, end, resized }) =>
      makeExecutionInput({ sink: terminalSink(terminal, end, resized), limits, ref, announce, carried }),
  }),
});

const writeFailure = (failure: ChannelFailed): InputWriteFailed =>
  new InputWriteFailed({
    reason: failure.reason === 'gone' || failure.reason === 'closed' ? 'closed' : failure.reason === 'stopped' ? 'stopped' : 'os',
    detail: failure.detail,
  });

export const terminalSink = (
  terminal: Terminal,
  end: TerminalInputOptions['end'],
  resized: TerminalInputOptions['resized'],
): InputSink => ({
  initiallyClosed: false,
  write: (bytes) => terminal.write(bytes).pipe(Effect.mapError(writeFailure)),
  stop: terminal.stopWriting,
  interrupt: (onFlush) =>
    terminal
      .interrupt(onFlush)
      .pipe(
        Effect.mapError((failure) =>
          failure._tag === 'TerminalInterruptRefused'
            ? new InputActUnsupported({ act: 'interrupt', reason: failure.reason, detail: failure.detail })
            : new InputWriteFailed({ reason: failure.reason === 'os' ? 'os' : 'closed', detail: failure.detail }),
        ),
      ),
  resize: (geometry) =>
    terminal.resize(geometry.rows, geometry.columns).pipe(
      Effect.mapError((failure) => new InputActUnsupported({ act: 'resize', reason: 'unreadable', detail: failure.detail })),
      Effect.andThen(resized(geometry)),
    ),
  end: { _tag: 'Closes', close: end },
});
