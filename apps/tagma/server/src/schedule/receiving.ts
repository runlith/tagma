import { Effect, Layer } from 'effect';
import { TickReceivers } from './contract/service/receivers.js';
import { TickRefused, type Ticks } from './contract/service/ticks.js';

export const tickReceiversLayer = Layer.sync(TickReceivers, () => {
  const receivers = new Map<string, Ticks['Service']>();
  return {
    register: (owner, receiver) => {
      if (receivers.has(owner)) throw new Error(`a tick receiver is already registered for ${owner}`);
      receivers.set(owner, receiver);
      return () => {
        if (receivers.get(owner) === receiver) receivers.delete(owner);
      };
    },
    deliver: (tick) =>
      Effect.suspend(() => {
        const receiver = receivers.get(tick.owner);
        return receiver === undefined
          ? Effect.fail(new TickRefused({ reason: `no receiver is bound for the schedules of ${tick.owner}` }))
          : receiver.deliver(tick);
      }),
  };
});
