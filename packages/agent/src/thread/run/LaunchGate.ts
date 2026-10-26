import { Context, Layer } from 'effect';

export const LAUNCH_REFUSALS_BEFORE_BLOCK = 2;

export class LaunchGate extends Context.Service<
  LaunchGate,
  {
    blocked(threadId: string): boolean;
    refused(threadId: string, lasting?: true): void;
    confirmed(threadId: string): void;
    lift(threadId: string): void;
  }
>()('@runlith/agent/LaunchGate') {}

export const launchGate = (): Context.Service.Shape<typeof LaunchGate> => {
  const refusals = new Map<string, number>();
  const clear = (threadId: string): void => void refusals.delete(threadId);
  return {
    blocked: (threadId) => (refusals.get(threadId) ?? 0) >= LAUNCH_REFUSALS_BEFORE_BLOCK,
    refused: (threadId, lasting) =>
      void refusals.set(threadId, lasting === true ? LAUNCH_REFUSALS_BEFORE_BLOCK : (refusals.get(threadId) ?? 0) + 1),
    confirmed: clear,
    lift: clear,
  };
};

export const launchGateLayer: Layer.Layer<LaunchGate> = Layer.sync(LaunchGate, launchGate);
