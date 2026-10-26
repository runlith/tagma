import { Data, Effect } from 'effect';

const URL_SAFE_PAD = /=+$/g;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(URL_SAFE_PAD, '');
}

function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export type PkceCodes = {
  verifier: string;
  challenge: string;
};

export class PkceFailed extends Data.TaggedError('PkceFailed')<{
  readonly cause: unknown;
}> {}

export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(64));
}

export function generateCodeChallenge(verifier: string): Effect.Effect<string, PkceFailed> {
  const data = new TextEncoder().encode(verifier);
  return Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-256', data),
    catch: (cause) => new PkceFailed({ cause }),
  }).pipe(Effect.map((hash) => base64UrlEncode(new Uint8Array(hash))));
}

export const generatePkce = Effect.fnUntraced(function* (): Effect.fn.Return<PkceCodes, PkceFailed> {
  const verifier = generateCodeVerifier();
  const challenge = yield* generateCodeChallenge(verifier);
  return { verifier, challenge };
});

export function generateState(prefix: string, randomBytesLength = 24): string {
  return prefix + base64UrlEncode(randomBytes(randomBytesLength));
}
