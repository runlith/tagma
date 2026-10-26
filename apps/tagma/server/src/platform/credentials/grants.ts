import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Data, Effect, FileSystem } from 'effect';
import {
  ACT_VARIABLE,
  GRANT_VARIABLE,
  OWN_GIT_VARIABLE,
  SESSION_TOKEN_VARIABLE,
  TERMINAL_VARIABLE,
} from '../contract/service/credentials.js';
import type { GrantSigner } from '../contract/service/grantSigner.js';
import type { SessionIdentity } from '../contract/wire/session.js';

class GrantKeyInvalid extends Data.TaggedError('GrantKeyInvalid')<{
  readonly path: string;
}> {}

export const grantSignerOver = (secret: Buffer): GrantSigner['Service'] => {
  const signature = (threadId: string): Buffer => createHmac('sha256', secret).update(threadId).digest();
  return {
    grantFor: (threadId) => `${threadId}.${signature(threadId).toString('base64url')}`,
    threadOf: (grant) => {
      const cut = grant.indexOf('.');
      if (cut <= 0) return null;
      const threadId = grant.slice(0, cut);
      const offered = Buffer.from(grant.slice(cut + 1), 'base64url');
      const mine = signature(threadId);
      return offered.length === mine.length && timingSafeEqual(offered, mine) ? threadId : null;
    },
  };
};

export const grantSignerAt = Effect.fn('grantSignerAt')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const key = yield* fs.readFile(path).pipe(
    Effect.catch((error) => {
      if (error.reason._tag !== 'NotFound') return Effect.fail(error);
      return Effect.gen(function* () {
        const created = randomBytes(32);
        yield* fs.writeFile(path, created, { flag: 'wx', mode: 0o600 });
        return created;
      });
    }),
  );
  if (key.length !== 32) return yield* new GrantKeyInvalid({ path });
  yield* fs.chmod(path, 0o600);
  return grantSignerOver(Buffer.from(key));
});

export function mintShellKey(): string {
  return randomBytes(16).toString('base64url');
}

export function shellDigest(key: string): string {
  return createHash('sha256').update(key).digest('base64url');
}

export const identityVariables = (identity: SessionIdentity['Service']): readonly string[] => [
  GRANT_VARIABLE,
  SESSION_TOKEN_VARIABLE,
  ACT_VARIABLE,
  TERMINAL_VARIABLE,
  OWN_GIT_VARIABLE,
  ...identity.extras,
];

export function grantEnvironment(
  signer: GrantSigner['Service'],
  threadId: string,
  identity: SessionIdentity['Service'],
): Record<string, string | undefined> {
  return { ...nobodyEnvironment(identity), [GRANT_VARIABLE]: signer.grantFor(threadId) };
}

export function sessionTokenEnvironment(
  signer: GrantSigner['Service'],
  threadId: string,
  sessionId: string,
  identity: SessionIdentity['Service'],
): Record<string, string | undefined> {
  return { ...grantEnvironment(signer, threadId, identity), [SESSION_TOKEN_VARIABLE]: sessionId };
}

export function nobodyEnvironment(identity: SessionIdentity['Service']): Record<string, string | undefined> {
  const carried: Record<string, string | undefined> = {};
  for (const variable of identityVariables(identity)) carried[variable] = undefined;
  return carried;
}

export function unsignedEnvironment(
  env: Record<string, string | undefined>,
  identity: SessionIdentity['Service'],
): Record<string, string | undefined> {
  const carried = { ...env };
  for (const variable of identityVariables(identity)) delete carried[variable];
  return carried;
}
