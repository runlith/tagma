import { Layer } from 'effect';
import { SessionIdentity } from '../contract/wire/session.js';

export const testSessionIdentity: SessionIdentity['Service'] = { prefix: {}, extras: [] };

export const testSessionIdentityLayer: Layer.Layer<SessionIdentity> = Layer.succeed(SessionIdentity, testSessionIdentity);
