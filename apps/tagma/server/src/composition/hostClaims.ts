import { Effect, Layer } from 'effect';
import { fileHolders } from '@runlith/execution-host/composition/platform';
import { ClaimHolders } from '../executions/contract/service/host.js';

export const claimHoldersLayer: Layer.Layer<ClaimHolders> = Layer.succeed(ClaimHolders, {
  of: (claim) =>
    fileHolders(claim).pipe(
      Effect.catchTag('BootRefused', (refused) => Effect.succeed({ _tag: 'Unread', detail: refused.detail } as const)),
    ),
});
