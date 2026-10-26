import { join } from 'node:path';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid, type CredentialFileFault } from '@runlith/credential-file/failure';
import { Effect, Schema } from 'effect';
import { SECRET_VALUE_MAX } from './contract/wire/entries.js';

const SECRETS_FILE = 'plugin-secrets.json';

export type Held = { readonly plugins: Readonly<Record<string, Readonly<Record<string, string>>>> };

const heldValue = Schema.String.check(Schema.isMaxLength(SECRET_VALUE_MAX), Schema.isPattern(/^[^\0]*$/u));
const heldSchema = Schema.Struct({ plugins: Schema.Record(Schema.String, Schema.Record(Schema.String, heldValue)) });

const decodeHeld = (path: string, parsed: unknown) =>
  Schema.decodeUnknownEffect(heldSchema)(parsed).pipe(
    Effect.map((value) => ({ value, needsWrite: false })),
    Effect.mapError(() => new CredentialFileInvalid({ path, reason: 'the document is not a plugin secret store' })),
  );

const without = (held: Held, plugin: string, name: string): Held => {
  const { [name]: _removed, ...kept } = held.plugins[plugin] ?? {};
  const { [plugin]: _plugin, ...others } = held.plugins;
  return { plugins: Object.keys(kept).length === 0 ? others : { ...others, [plugin]: kept } };
};

export const makeStore = (input: { readonly home: string }) => {
  const file = makeCredentialFile<Held>({
    path: join(input.home, SECRETS_FILE),
    codec: { empty: () => ({ plugins: {} }), decode: decodeHeld },
  });
  const changing = Effect.fn('PluginSecrets.changing')(function* (
    change: (held: Held) => Held,
  ): Effect.fn.Return<boolean, CredentialFileFault> {
    let changed = false;
    yield* file.update((held) => {
      const next = change(held);
      changed = next !== held;
      return Effect.succeed(next);
    });
    return changed;
  });
  return {
    all: () => file.read(),
    of: (plugin: string) => Effect.map(file.read(), (held) => held.plugins[plugin] ?? {}),
    set: (plugin: string, name: string, value: string) =>
      changing((held) =>
        held.plugins[plugin]?.[name] === value
          ? held
          : { plugins: { ...held.plugins, [plugin]: { ...held.plugins[plugin], [name]: value } } },
      ),
    remove: (plugin: string, name: string) =>
      changing((held) => (held.plugins[plugin]?.[name] === undefined ? held : without(held, plugin, name))),
  };
};

export type SecretStore = ReturnType<typeof makeStore>;
