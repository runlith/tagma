import type { CredentialFile } from '@runlith/credential-file/CredentialFile';
import { Context, Effect, Layer } from 'effect';
import { SecretOwners, Secrets } from '../contract/service/secrets.js';
import { makeKeeper } from '../keeper.js';
import { EMPTY, type Held } from '../store.js';

const memoryFile = (): CredentialFile<Held> => {
  let held = EMPTY;
  return {
    read: () => Effect.sync(() => held),
    readFresh: () => Effect.sync(() => held),
    update: (change) =>
      Effect.flatMap(
        Effect.suspend(() => change(held)),
        (next) =>
          Effect.sync(() => {
            held = next;
          }),
      ),
  };
};

export const memorySecretsLayer = (): Layer.Layer<Secrets | SecretOwners> =>
  Layer.effectContext(
    Effect.sync(() => {
      const { secrets, owners } = makeKeeper({ file: memoryFile() });
      return Context.make(Secrets, secrets).pipe(Context.add(SecretOwners, owners));
    }),
  );
