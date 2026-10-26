import { Context, type Stream } from 'effect';
import type { SubscriptionSource } from './protocol/wire';
import type { ExecutionsFailure, ExecutionFeedItem } from './Executions';

export class ExecutionFeed extends Context.Service<
  ExecutionFeed,
  {
    readonly subscribe: (source: SubscriptionSource, credits: number) => Stream.Stream<ExecutionFeedItem, ExecutionsFailure>;
  }
>()('@runlith/executions/ExecutionFeed') {}
