import { Context, type Stream } from 'effect';

export class YieldRequests extends Context.Service<
  YieldRequests,
  {
    readonly asked: Stream.Stream<void>;
  }
>()('@runlith/execution-host/YieldRequests') {}
