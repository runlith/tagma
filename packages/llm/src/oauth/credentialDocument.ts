import { Effect, Schema } from 'effect';
import { AccountKey } from '../models/authStatus.js';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';

const storedRowSchema = Schema.Struct({
  key: AccountKey,
  label: Schema.String,
  addedAt: Schema.Number,
  credential: Schema.Unknown,
});

export type StoredRow = typeof storedRowSchema.Type;

export type ProviderRows = Readonly<Record<string, StoredRow>>;

export type CredentialDocument = { readonly providers: Readonly<Record<string, ProviderRows>> };

export type DecodedDocument = { readonly value: CredentialDocument; readonly needsWrite: boolean };

const documentSchema = Schema.Struct({
  providers: Schema.Record(Schema.String, Schema.Record(Schema.String, storedRowSchema)),
});

export function emptyDocument(): CredentialDocument {
  return { providers: {} };
}

export function rowsOf(document: CredentialDocument, provider: string): ProviderRows {
  return document.providers[provider] ?? {};
}

export function withRows(document: CredentialDocument, provider: string, rows: ProviderRows): CredentialDocument {
  return { providers: { ...document.providers, [provider]: rows } };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const withoutOrigins = (parsed: unknown): { readonly value: unknown; readonly moved: boolean; readonly failure: string | null } => {
  if (!record(parsed) || !record(parsed.providers)) return { value: parsed, moved: false, failure: null };
  let moved = false;
  let failure: string | null = null;
  const providers = Object.fromEntries(
    Object.entries(parsed.providers).map(([provider, rows]) => {
      if (!record(rows)) return [provider, rows];
      const kept = Object.entries(rows).flatMap(([key, row]) => {
        if (!record(row) || !('origin' in row)) return [[key, row] as const];
        moved = true;
        const { origin, ...rest } = row;
        if (!record(origin) || (origin.kind !== 'own' && (origin.kind !== 'imported' || typeof origin.source !== 'string')))
          failure = `The stored origin of ${provider}/${key} is malformed`;
        return record(origin) && origin.kind === 'imported' ? [] : [[key, rest] as const];
      });
      return [provider, Object.fromEntries(kept)];
    }),
  );
  return { value: { ...parsed, providers }, moved, failure };
};

export function decodeDocument(path: string, parsed: unknown, _modifiedAt: number): Effect.Effect<DecodedDocument, CredentialFileInvalid> {
  const hadEnvelope = record(parsed) && 'version' in parsed;
  const settled = withoutOrigins(parsed);
  if (settled.failure !== null) return Effect.fail(new CredentialFileInvalid({ path, reason: settled.failure }));
  return Schema.decodeUnknownEffect(documentSchema)(settled.value).pipe(
    Effect.mapError((issue) => new CredentialFileInvalid({ path, reason: issue.message })),
    Effect.flatMap((decoded) => {
      for (const [provider, rows] of Object.entries(decoded.providers)) {
        for (const [key, row] of Object.entries(rows)) {
          if (row.key !== key) {
            return Effect.fail(
              new CredentialFileInvalid({ path, reason: `${provider} account row key ${row.key} does not match map key ${key}` }),
            );
          }
        }
      }
      return Effect.succeed({ value: { providers: decoded.providers }, needsWrite: hadEnvelope || settled.moved });
    }),
  );
}
