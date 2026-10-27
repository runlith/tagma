import { Context, Data, Effect, type Scope } from 'effect';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type { BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { LaneInput, TerminalLane } from '@runlith/executions/protocol/lane';
import type { ByteOffset, TerminalGeometry } from '@runlith/executions/protocol/record';
import type { Binding } from './Bindings';
import {
  InputActUnsupported,
  InputWriteFailed,
  makeExecutionInput,
  type ExecutionInput,
  type InputCarry,
  type InputSink,
} from './ExecutionInput';
import type { ChannelFailed, Terminal } from './holder/Holder';

export class LaneUnserved extends Data.TaggedError('LaneUnserved')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export type TerminalInputOptions = {
  readonly limits: ExecutionLimits;
  readonly ref: ExecutionRef;
  readonly announce: Effect.Effect<void>;
  readonly carried?: InputCarry;
  readonly end: () => Effect.Effect<void, InputWriteFailed>;
  readonly resized: (geometry: TerminalGeometry) => Effect.Effect<void, InputActUnsupported>;
  readonly output: ByteOffset;
  readonly admitted: (input: LaneInput) => Effect.Effect<void>;
};

export type TerminalEndpoint = {
  readonly open: (binding: Binding) => Effect.Effect<TerminalLane, LaneUnserved>;
  readonly close: (binding: BindingId) => Effect.Effect<void>;
};

export type TerminalInput = {
  readonly input: ExecutionInput;
  readonly endpoint: TerminalEndpoint | undefined;
};

export type AdmittedInputs = Map<string, LaneInput>;

export const admittedInto = (held: AdmittedInputs, input: LaneInput): void => {
  const key = `${input.binding}\u0000${input.receipt.cause}`;
  held.delete(key);
  held.set(key, input);
};

export const droppedFrom = (held: AdmittedInputs, binding: BindingId): void => {
  for (const [key, input] of held) if (input.binding === binding) held.delete(key);
};

export type TerminalInputs = {
  readonly open: (terminal: Terminal, options: TerminalInputOptions) => Effect.Effect<TerminalInput, never, Scope.Scope>;
};

export const TerminalInputs = Context.Reference<TerminalInputs>('@runlith/execution-host/TerminalInputs', {
  defaultValue: () => ({
    open: (terminal, { limits, ref, announce, carried, end, resized }) =>
      Effect.map(makeExecutionInput({ sink: terminalSink(terminal, end, resized), limits, ref, announce, carried }), (input) => ({
        input,
        endpoint: undefined,
      })),
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
