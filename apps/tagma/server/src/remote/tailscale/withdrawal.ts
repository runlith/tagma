import { Effect } from 'effect';
import { WithdrawalRefused } from '../contract/service/exposure.js';
import type { Blocked } from '../contract/wire/access.js';
import { failureOf, locateCli, runCli, succeeded } from './cli.js';
import { holderOf, servedPorts, withdrawArgs, targetOf } from './mapping.js';
import { hostOf, readServeConfig, readStatus } from './tailnet.js';

const refusedBy = (blocked: Blocked): WithdrawalRefused => new WithdrawalRefused({ reason: blocked.detail });

const switchOff = Effect.fn('tailscale.serveOff')(function* (binary: string, httpsPort: number) {
  const run = yield* runCli(binary, withdrawArgs(httpsPort)).pipe(
    Effect.mapError((failed) => new WithdrawalRefused({ reason: failed.reason })),
  );
  if (!succeeded(run)) return yield* new WithdrawalRefused({ reason: `https=${httpsPort} stays mapped: ${failureOf(run)}` });
});

export const withdraw = Effect.fn('Exposure.withdraw')(function* (ports: readonly number[]) {
  const binary = yield* locateCli;
  if (binary === null) return;
  const status = yield* readStatus(binary).pipe(Effect.mapError(refusedBy));
  const host = hostOf(status);
  if (host === null) return yield* new WithdrawalRefused({ reason: 'Tailscale reports no DNS name for this machine' });
  const config = yield* readServeConfig(binary).pipe(Effect.mapError(refusedBy));
  const targets = ports.map(targetOf);
  const ours = servedPorts(config, host).filter((httpsPort) =>
    targets.some((target) => holderOf([config], host, httpsPort, target)._tag === 'tagma'),
  );
  yield* Effect.forEach(ours, (httpsPort) => switchOff(binary, httpsPort), { discard: true });
});
