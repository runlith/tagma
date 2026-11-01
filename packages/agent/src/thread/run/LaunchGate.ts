import { Context, Layer } from 'effect';
import { createEventEmitter } from '@runlith/utils/event';

import type { LaunchBlock } from '../../transcript/live';

export const LAUNCH_REFUSALS_BEFORE_BLOCK = 2;

export class LaunchGate extends Context.Service<
  LaunchGate,
  {
    blocked(threadId: string): boolean;
    refused(threadId: string, lasting?: true): void;
    confirmed(threadId: string): void;
    lift(threadId: string): void;
    subscribe(listener: (change: LaunchBlock) => void): () => void;
  }
>()('@runlith/agent/LaunchGate') {}

export const launchGate = (): Context.Service.Shape<typeof LaunchGate> => {
  const refusals = new Map<string, number>();
  const changes = createEventEmitter<[LaunchBlock]>((cause) => console.error('a launch gate listener failed', cause));
  const blocked = (threadId: string): boolean => (refusals.get(threadId) ?? 0) >= LAUNCH_REFUSALS_BEFORE_BLOCK;
  const clear = (threadId: string): void => {
    const was = blocked(threadId);
    refusals.delete(threadId);
    if (was) changes.emit({ threadId, blocked: false });
  };
  return {
    blocked,
    refused: (threadId, lasting) => {
      const was = blocked(threadId);
      refusals.set(threadId, lasting === true ? LAUNCH_REFUSALS_BEFORE_BLOCK : (refusals.get(threadId) ?? 0) + 1);
      if (!was && blocked(threadId)) changes.emit({ threadId, blocked: true });
    },
    confirmed: clear,
    lift: clear,
    subscribe: changes.subscribe,
  };
};

export const launchGateLayer: Layer.Layer<LaunchGate> = Layer.sync(LaunchGate, launchGate);
