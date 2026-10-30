import type { Signer } from '../../cli/contract/service/server.js';
import { BUILTIN_HARNESS_PROVIDERS } from '../adapters.js';

export const SIGNERS: readonly Signer[] = await Promise.all(
  [...BUILTIN_HARNESS_PROVIDERS.values()].map(({ id, signer }) => (signer === undefined ? { harness: id } : signer())),
);
