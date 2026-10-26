import { Effect, type Scope } from 'effect';
import { Registry, type RegistryCollision } from '../registry/Registry';

export type RegisteredToolSource<TRequest, TOffer, TFail> = {
  readonly id: string;
  readonly owner: string;
  readonly names: readonly string[];
  offer(request: TRequest): Effect.Effect<TOffer | null, TFail>;
};

export type ToolSourceRegistry<TRequest, TOffer, TFail> = ReturnType<typeof makeToolSourceRegistry<TRequest, TOffer, TFail>>;

export const makeToolSourceRegistry = <TRequest, TOffer, TFail>({
  declined,
  stamped = (offer) => offer,
}: {
  readonly declined: (id: string, names: readonly string[]) => TOffer;
  readonly stamped?: (offer: TOffer, standing: () => boolean, removed: Effect.Effect<void>) => TOffer;
}) => {
  const sources = new Registry<RegisteredToolSource<TRequest, TOffer, TFail>>('tool source');
  return {
    register: (source: RegisteredToolSource<TRequest, TOffer, TFail>): Effect.Effect<() => void, RegistryCollision> =>
      sources.register(source.id, source.owner, source),

    hold: (source: RegisteredToolSource<TRequest, TOffer, TFail>): Effect.Effect<void, RegistryCollision, Scope.Scope> =>
      sources.hold(source.id, source.owner, source),

    offers: Effect.fnUntraced(function* (request: TRequest, only?: readonly string[]): Effect.fn.Return<readonly TOffer[], TFail> {
      const offers: TOffer[] = [];
      for (const { value: source, standing, removed } of sources.registrations()) {
        if (only !== undefined && !only.includes(source.id)) {
          offers.push(declined(source.id, source.names));
          continue;
        }
        const offered = yield* source.offer(request);
        if (offered !== null) offers.push(stamped(offered, standing, removed));
      }
      return offers;
    }),
  };
};
