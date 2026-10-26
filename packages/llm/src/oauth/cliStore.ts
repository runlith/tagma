import { readFile } from 'node:fs/promises';
import { Data, Effect } from 'effect';
import { type CredentialSchema, parseStoredCredential, type StoredCredential } from './credential.js';

export type CliIdentity = { readonly label: string; readonly email?: string };

export type CliLogin = {
  readonly provider: string;
  readonly source: string;
  readonly credential: StoredCredential;
  readonly identity: CliIdentity;
};

export class CliLoginUnreadable extends Data.TaggedError('CliLoginUnreadable')<{
  readonly provider: string;
  readonly source: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `The ${this.provider} CLI login at ${this.source} cannot be read: ${this.detail}`;
  }
}

export type CliLoginSource<C extends StoredCredential> = {
  readonly credential: C;
  readonly identity?: CliIdentity;
};

export type JsonRecord = Record<string, unknown>;

class StoreAbsent extends Data.TaggedError('StoreAbsent') {}

const detailOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const unreadable = (provider: string, source: string, cause: unknown) =>
  new CliLoginUnreadable({ provider, source, detail: detailOf(cause) });

const absentPath = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && (cause.code === 'ENOENT' || cause.code === 'ENOTDIR');

export function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function configuredHome(variable: string, fallback: string): string {
  return nonEmptyString(process.env[variable]) ?? fallback;
}

function readStore(provider: string, path: string): Effect.Effect<string | null, CliLoginUnreadable> {
  return Effect.tryPromise({
    try: () => readFile(path, 'utf8'),
    catch: (cause) => (absentPath(cause) ? new StoreAbsent() : unreadable(provider, path, cause)),
  }).pipe(Effect.catchTag('StoreAbsent', () => Effect.succeed(null)));
}

export function parsedText(
  provider: string,
  source: string,
  text: string,
  parse: (text: string) => unknown,
): Effect.Effect<unknown, CliLoginUnreadable> {
  return Effect.try({ try: () => parse(text), catch: (cause) => unreadable(provider, source, cause) });
}

function readParsed(provider: string, path: string, parse: (text: string) => unknown): Effect.Effect<unknown | null, CliLoginUnreadable> {
  return Effect.flatMap(readStore(provider, path), (text) =>
    text === null ? Effect.succeed(null) : parsedText(provider, path, text, parse),
  );
}

export const readJson = (provider: string, path: string) => readParsed(provider, path, JSON.parse);

export function jwtClaims(provider: string, source: string, token: string): Effect.Effect<JsonRecord | null, CliLoginUnreadable> {
  const body = token.split('.')[1];
  if (!body) return Effect.succeed(null);
  return Effect.map(
    parsedText(provider, source, body, (encoded) => JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))),
    asRecord,
  );
}

export function parsedCliLoginSource<C extends StoredCredential>(input: {
  readonly provider: string;
  readonly schema: CredentialSchema<C>;
  readonly source: string;
  readonly value: unknown;
  readonly identity?: CliIdentity;
}): Effect.Effect<CliLoginSource<C>, CliLoginUnreadable> {
  return parseStoredCredential(input.provider, input.schema, input.value).pipe(
    Effect.map((credential) => ({ credential, identity: input.identity })),
    Effect.mapError((invalid) => new CliLoginUnreadable({ provider: input.provider, source: input.source, detail: invalid.detail })),
  );
}

export function foundLogin<C extends StoredCredential>(provider: string, source: string, found: CliLoginSource<C> | null): CliLogin | null {
  return found?.identity ? { provider, source, credential: found.credential, identity: found.identity } : null;
}
