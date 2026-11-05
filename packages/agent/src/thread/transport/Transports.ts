import { Context, Effect, Layer } from 'effect';
import { isUnread } from '../record';
import {
  TransportMismatch,
  TransportRegistered,
  TransportUnread,
  TransportUnregistered,
  type Transport,
  type TransportRegistry,
} from './contract';

function mismatchOf(transport: Transport): TransportMismatch | null {
  const { adapter, declares } = transport;
  const subjects = [
    { capability: 'history', subject: 'TransportHistory', declared: declares.history === 'session', held: transport.history !== undefined },
    {
      capability: 'compaction',
      subject: 'TransportCompaction',
      declared: declares.compaction === 'session',
      held: transport.compaction !== undefined,
    },
  ];
  const diverged = subjects.find((each) => each.declared !== each.held);
  return diverged === undefined
    ? null
    : new TransportMismatch({ adapter, capability: diverged.capability, subject: diverged.subject, declared: diverged.declared });
}

export class Transports extends Context.Service<Transports, TransportRegistry>()('@runlith/agent/Transports') {}

export const transportsLayer: Layer.Layer<Transports> = Layer.sync(Transports, () => {
  const registered = new Map<string, Transport>();
  return {
    register: (transport) =>
      Effect.suspend((): Effect.Effect<void, TransportMismatch | TransportRegistered> => {
        if (registered.has(transport.adapter)) return Effect.fail(new TransportRegistered({ adapter: transport.adapter }));
        const mismatch = mismatchOf(transport);
        if (mismatch !== null) return Effect.fail(mismatch);
        registered.set(transport.adapter, transport);
        return Effect.void;
      }),
    of: (seated) => {
      if (isUnread(seated, 'transport')) return Effect.fail(new TransportUnread());
      const { adapter } = seated.transport;
      const transport = registered.get(adapter);
      return transport === undefined ? Effect.fail(new TransportUnregistered({ adapter })) : Effect.succeed(transport);
    },
    all: () => [...registered.values()],
  };
});
