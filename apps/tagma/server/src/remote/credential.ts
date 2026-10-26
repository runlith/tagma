import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export type Credential = { readonly id: string; readonly secret: string };

const SECRET_BYTES = 32;

export const digestOf = (secret: string): string => createHash('sha256').update(secret).digest('hex');

export const mintCredential = (): Credential & { readonly value: string } => {
  const id = randomUUID();
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { id, secret, value: `${id}.${secret}` };
};

export const readCredential = (value: string | undefined): Credential | null => {
  if (value === undefined) return null;
  const at = value.indexOf('.');
  if (at <= 0 || at === value.length - 1) return null;
  return { id: value.slice(0, at), secret: value.slice(at + 1) };
};

export const provedBy = (digest: string, secret: string): boolean => {
  const stored = Buffer.from(digest, 'hex');
  const offered = createHash('sha256').update(secret).digest();
  return stored.length === offered.length && timingSafeEqual(stored, offered);
};
