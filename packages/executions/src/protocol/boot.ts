import { Schema } from 'effect';
import { Digest } from './artifact';
import { ExecutionPolicy } from './capacity';
import { Registration } from './registration';
import { WireLimits } from './wire';

export const OUTPUT_LIMIT_VARIABLE = 'EXECUTION_OUTPUT_LIMIT';

export const HostLifetime = Schema.Literals(['detached', 'with-parent']);
export type HostLifetime = typeof HostLifetime.Type;

export const HostBoot = Schema.Struct({
  state: Schema.NonEmptyString,
  registration: Registration,
  library: Schema.NonEmptyString,
  policy: ExecutionPolicy,
  share: Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1)),
  limits: WireLimits,
  lifetime: Schema.optional(HostLifetime),
  artifact: Schema.optional(Schema.NonEmptyString),
});
export type HostBoot = typeof HostBoot.Type;

export const bootName = (digest: Digest): string => `boot-${digest.slice(digest.indexOf(':') + 1)}.json`;

export const bootPath = (state: string, digest: Digest): string => `${state}/${bootName(digest)}`;

export const loadRefusalOf = (boot: string): string => `${boot.endsWith('.json') ? boot.slice(0, -'.json'.length) : boot}.refused`;

export const yieldRefusalPath = (state: string): string => `${state}/bundle.next.refused`;

export const YieldRefusal = Schema.Struct({
  candidate: Schema.optional(Digest),
  detail: Schema.String,
});
export type YieldRefusal = typeof YieldRefusal.Type;
