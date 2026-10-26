import { Effect, Layer } from 'effect';
import { OutcomeRefused, type Outcomes } from './contract/service/outcomes.js';
import { Senders } from './contract/service/senders.js';

export const sendersLayer = Layer.sync(Senders, () => {
  const receivers = new Map<string, Outcomes['Service']>();
  return {
    register: (sender, receiver) => {
      if (receivers.has(sender)) throw new Error(`a notification receiver is already registered for ${sender}`);
      receivers.set(sender, receiver);
      return () => {
        if (receivers.get(sender) === receiver) receivers.delete(sender);
      };
    },
    accepts: (sender) => receivers.has(sender),
    deliver: (outcome) =>
      Effect.suspend(() => {
        const receiver = receivers.get(outcome.sender);
        return receiver === undefined
          ? Effect.fail(new OutcomeRefused({ reason: `no receiver is bound for the notifications of ${outcome.sender}` }))
          : receiver.deliver(outcome);
      }),
  };
});
