import { grantEnvironment as environment, grantSignerOver, sessionTokenEnvironment as sessionEnvironment } from '../credentials/grants.js';
import type { SessionIdentity } from '../contract/wire/session.js';

export const testGrantSigner = grantSignerOver(Buffer.alloc(32, 7));

export const grantFor = (threadId: string): string => testGrantSigner.grantFor(threadId);

export const threadOfGrant = (grant: string): string | null => testGrantSigner.threadOf(grant);

export const grantEnvironment = (threadId: string, identity: SessionIdentity['Service']) =>
  environment(testGrantSigner, threadId, identity);

export const sessionTokenEnvironment = (threadId: string, sessionId: string, identity: SessionIdentity['Service']) =>
  sessionEnvironment(testGrantSigner, threadId, sessionId, identity);
