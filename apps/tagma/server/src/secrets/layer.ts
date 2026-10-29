import { Context, Effect, Layer } from 'effect';
import { SecretOwners, Secrets, SecretsPlace } from './contract/service/secrets.js';
import { makeKeeper } from './keeper.js';
import { openStore } from './store.js';

export const secretsLayer: Layer.Layer<Secrets | SecretOwners, never, SecretsPlace> = Layer.effectContext(
  Effect.map(SecretsPlace, ({ home }) => {
    const { secrets, owners } = makeKeeper({ file: home === null ? null : openStore(home) });
    return Context.make(Secrets, secrets).pipe(Context.add(SecretOwners, owners));
  }),
);
