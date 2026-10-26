import { createHash } from 'node:crypto';
import { type CommandAdmission, originOf } from '@runlith/executions/protocol/command';
import { type LaunchRequest } from '@runlith/executions/protocol/launch';

const LAUNCH_IDENTITY = 'launch/7';

type Canonical = string | number | null | ReadonlyArray<Canonical>;

export const fingerprintOf = (launch: LaunchRequest): string =>
  JSON.stringify([
    LAUNCH_IDENTITY,
    launch.transport,
    launch.lifetime,
    launch.purpose,
    launch.command.program,
    launch.command.args,
    launch.command.cwd ?? null,
    environmentDigest(launch.command.environment),
    launch.target.environment,
    launch.target.namespace,
    launch.target.cwd,
    launch.target.dependencies,
    launch.holder,
    launch.origin,
    launch.lifetime === 'command' ? admissionIdentity(launch.admission) : [launch.budget?.timeoutMs ?? null],
  ]);

const admissionIdentity = (admission: CommandAdmission): ReadonlyArray<Canonical> => [
  admission.origin.scope,
  admission.origin.owner,
  admission.origin.cohort,
  admission.limits.executionMs ?? null,
  admission.limits.executionCeilingMs ?? null,
  originOf(admission.limits),
  admission.limits.foregroundMs ?? null,
  admission.policyIdentity,
  admission.tool ?? null,
  admission.requested ?? null,
  (admission.rules ?? []).map((rule) => rule.id).join(' '),
];

const environmentDigest = (environment: LaunchRequest['command']['environment']): string =>
  createHash('sha256')
    .update(
      environment
        .map((entry) => `${entry.name}\u0000${entry.value}`)
        .sort()
        .join('\u0001'),
    )
    .digest('hex');
