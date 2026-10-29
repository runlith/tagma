import { join } from 'node:path';
import { type CredentialFile, makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';
import { Effect, Schema } from 'effect';
import { SECRET_VALUE_MAX } from './contract/wire/rows.js';

export const SECRETS_FILE = 'secrets.json';

type Values = Readonly<Record<string, string>>;
type Kept = { readonly values: Values; readonly signIn?: unknown };
export type Held = { readonly owners: Readonly<Record<string, Readonly<Record<string, Kept>>>> };

const heldValue = Schema.String.check(Schema.isMaxLength(SECRET_VALUE_MAX), Schema.isPattern(/^[^\0]*$/u));
const heldSchema = Schema.Struct({
  owners: Schema.Record(
    Schema.String,
    Schema.Record(
      Schema.String,
      Schema.Struct({ values: Schema.Record(Schema.String, heldValue), signIn: Schema.optional(Schema.Unknown) }),
    ),
  ),
});

const decodeHeld = (path: string, parsed: unknown) =>
  Schema.decodeUnknownEffect(heldSchema)(parsed).pipe(
    Effect.map((value) => ({ value, needsWrite: false })),
    Effect.mapError(() => new CredentialFileInvalid({ path, reason: 'the document is not a secret store' })),
  );

export const EMPTY: Held = { owners: {} };

const keptOf = (held: Held, kind: string, key: string): Kept => held.owners[kind]?.[key] ?? { values: {} };

export const valuesOf = (held: Held, kind: string, key: string): Values => keptOf(held, kind, key).values;

export const signInOf = (held: Held, kind: string, key: string): unknown => keptOf(held, kind, key).signIn;

const withKept = (held: Held, kind: string, key: string, kept: Kept): Held => {
  const { [key]: _key, ...keys } = held.owners[kind] ?? {};
  const { [kind]: _kind, ...kinds } = held.owners;
  const empty = Object.keys(kept.values).length === 0 && kept.signIn === undefined;
  const standing = empty ? keys : { ...keys, [key]: kept.signIn === undefined ? { values: kept.values } : kept };
  return { owners: Object.keys(standing).length === 0 ? kinds : { ...kinds, [kind]: standing } };
};

const withValues = (held: Held, kind: string, key: string, values: Values): Held =>
  withKept(held, kind, key, { ...keptOf(held, kind, key), values });

export const withSignIn = (held: Held, kind: string, key: string, signIn: unknown): Held =>
  withKept(held, kind, key, { ...keptOf(held, kind, key), signIn });

export const put = (held: Held, kind: string, key: string, name: string, value: string): Held =>
  valuesOf(held, kind, key)[name] === value ? held : withValues(held, kind, key, { ...valuesOf(held, kind, key), [name]: value });

export const without = (held: Held, kind: string, key: string, name: string): Held => {
  const { [name]: removed, ...kept } = valuesOf(held, kind, key);
  return removed === undefined ? held : withValues(held, kind, key, kept);
};

export const dropped = (held: Held, kind: string, key: string): Held =>
  held.owners[kind]?.[key] === undefined ? held : withKept(held, kind, key, { values: {} });

export const adopted = (held: Held, kind: string, given: Readonly<Record<string, Values>>): Held =>
  Object.entries(given).reduce(
    (carried, [key, values]) =>
      Object.entries(values).reduce(
        (inner, [name, value]) =>
          valuesOf(inner, kind, key)[name] === undefined && value !== '' ? put(inner, kind, key, name, value) : inner,
        carried,
      ),
    held,
  );

export const openStore = (home: string): CredentialFile<Held> =>
  makeCredentialFile<Held>({ path: join(home, SECRETS_FILE), codec: { empty: () => EMPTY, decode: decodeHeld } });
