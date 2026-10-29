import { join } from 'node:path';
import { type CredentialFile, makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';
import { Effect, Schema } from 'effect';
import { SECRET_VALUE_MAX } from './contract/wire/rows.js';

export const SECRETS_FILE = 'secrets.json';

type Values = Readonly<Record<string, string>>;
type Kept = { readonly values: Values };
export type Held = { readonly owners: Readonly<Record<string, Readonly<Record<string, Kept>>>> };

const heldValue = Schema.String.check(Schema.isMaxLength(SECRET_VALUE_MAX), Schema.isPattern(/^[^\0]*$/u));
const heldSchema = Schema.Struct({
  owners: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Struct({ values: Schema.Record(Schema.String, heldValue) }))),
});

const decodeHeld = (path: string, parsed: unknown) =>
  Schema.decodeUnknownEffect(heldSchema)(parsed).pipe(
    Effect.map((value) => ({ value, needsWrite: false })),
    Effect.mapError(() => new CredentialFileInvalid({ path, reason: 'the document is not a secret store' })),
  );

export const EMPTY: Held = { owners: {} };

export const valuesOf = (held: Held, kind: string, key: string): Values => held.owners[kind]?.[key]?.values ?? {};

const withValues = (held: Held, kind: string, key: string, values: Values): Held => {
  const { [key]: _key, ...keys } = held.owners[kind] ?? {};
  const { [kind]: _kind, ...kinds } = held.owners;
  const kept = Object.keys(values).length === 0 ? keys : { ...keys, [key]: { values } };
  return { owners: Object.keys(kept).length === 0 ? kinds : { ...kinds, [kind]: kept } };
};

export const put = (held: Held, kind: string, key: string, name: string, value: string): Held =>
  valuesOf(held, kind, key)[name] === value ? held : withValues(held, kind, key, { ...valuesOf(held, kind, key), [name]: value });

export const without = (held: Held, kind: string, key: string, name: string): Held => {
  const { [name]: removed, ...kept } = valuesOf(held, kind, key);
  return removed === undefined ? held : withValues(held, kind, key, kept);
};

export const dropped = (held: Held, kind: string, key: string): Held =>
  held.owners[kind]?.[key] === undefined ? held : withValues(held, kind, key, {});

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
