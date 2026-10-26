import { Effect, type Scope } from 'effect';
import { Registry, type RegistryCollision } from '../../registry/Registry';
import { ThreadCallBroke } from '../ThreadBorder';
import type { ThreadAgent } from './ThreadAgent';
import type { ThreadWriteTx } from '../ThreadPorts';

export type AgentRegistry<TWrite = ThreadWriteTx> = {
  register(agent: ThreadAgent<TWrite>, owner: string): Effect.Effect<() => void, RegistryCollision>;
  hold(agent: ThreadAgent<TWrite>, owner: string): Effect.Effect<void, RegistryCollision, Scope.Scope>;
  get(id: string): Effect.Effect<ThreadAgent<TWrite>, ThreadCallBroke>;
  find(id: string): ThreadAgent<TWrite> | undefined;
  list(): readonly ThreadAgent<TWrite>[];
};

export const makeAgentRegistry = Effect.fnUntraced(function* <TWrite = ThreadWriteTx>(): Effect.fn.Return<AgentRegistry<TWrite>> {
  const agents = new Registry<ThreadAgent<TWrite>>('agent');
  return {
    register: (agent: ThreadAgent<TWrite>, owner: string): Effect.Effect<() => void, RegistryCollision> =>
      agents.register(agent.id, owner, agent),
    hold: (agent: ThreadAgent<TWrite>, owner: string): Effect.Effect<void, RegistryCollision, Scope.Scope> =>
      agents.hold(agent.id, owner, agent),
    get: (id: string): Effect.Effect<ThreadAgent<TWrite>, ThreadCallBroke> =>
      Effect.mapError(agents.get(id), (cause) => new ThreadCallBroke({ cause })),
    find: (id: string): ThreadAgent<TWrite> | undefined => agents.find(id),
    list: (): readonly ThreadAgent<TWrite>[] => agents.values(),
  };
});
