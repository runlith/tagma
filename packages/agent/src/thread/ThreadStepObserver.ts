import { Context, Layer, PubSub } from 'effect';
import type { AgentStep } from '../agent/AgentStep';
import type { ThreadRunRow } from './rows';

export type ThreadStepFinished = {
  readonly run: ThreadRunRow;
  readonly stepNumber: number;
  readonly step: AgentStep;
};

export class ThreadStepObserver extends Context.Service<ThreadStepObserver, PubSub.PubSub<ThreadStepFinished>>()(
  '@runlith/agent/ThreadStepObserver',
) {}

export const threadStepObserverLayer: Layer.Layer<ThreadStepObserver> = Layer.effect(
  ThreadStepObserver,
  PubSub.unbounded<ThreadStepFinished>(),
);
