import { Effect, Layer } from 'effect';
import { fileHolders } from '@runlith/execution-host/composition/platform';
import { ClaimHolders } from '../executions/contract/service/host.js';
import { LockHolders } from '../installation/contract/service/lockHolders.js';

const holdersOf = (file: string) =>
  fileHolders(file).pipe(Effect.catchTag('BootRefused', (refused) => Effect.succeed({ _tag: 'Unread', detail: refused.detail } as const)));

export const claimHoldersLayer: Layer.Layer<ClaimHolders> = Layer.succeed(ClaimHolders, { of: holdersOf });

export const lockHoldersLayer: Layer.Layer<LockHolders> = Layer.succeed(LockHolders, { of: holdersOf });
