import type { GuestLimits } from '../../contract/wire/sandbox.js';
import { GUEST_HOME, GUEST_TMP, GUEST_USER, GUEST_TREE } from './layout.js';

export const INSTALLATION_LABEL = 'tagma.installation';
export const KIND_LABEL = 'tagma.kind';
export const SUBJECT_LABEL = 'tagma.subject';

export type GuestKind = 'workload' | 'builder' | 'proxy' | 'readiness' | 'reader';

export type GuestMarks = {
  readonly installation: string;
  readonly kind: GuestKind;
  readonly subject: string;
};

export type GuestBoundary = {
  readonly name: string;
  readonly image: string;
  readonly volume: string;
  readonly limits: GuestLimits;
  readonly marks: GuestMarks;
  readonly network: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly readOnlyTree?: boolean;
};

export function guestRunCommand(boundary: GuestBoundary): readonly string[] {
  return [
    'run',
    '--detach',
    '--name',
    boundary.name,
    '--user',
    GUEST_USER,
    '--read-only',
    '--network',
    boundary.network,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--init',
    '--pids-limit',
    String(boundary.limits.pids),
    '--memory',
    boundary.limits.memory,
    '--cpus',
    boundary.limits.cpus,
    ...labelFlags(boundary.marks),
    ...Object.entries(boundary.environment ?? {}).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    '--mount',
    `type=volume,src=${boundary.volume},dst=${GUEST_TREE}${boundary.readOnlyTree === true ? ',readonly' : ''}`,
    '--tmpfs',
    `${GUEST_TMP}:rw,nosuid,nodev,noexec,uid=65534,gid=65534,mode=1777`,
    '--tmpfs',
    `${GUEST_HOME}:rw,nosuid,nodev,noexec,uid=65534,gid=65534,mode=0700`,
    '--workdir',
    GUEST_TREE,
    boundary.image,
  ];
}

export function labelFlags(marks: GuestMarks): readonly string[] {
  return [
    '--label',
    `${INSTALLATION_LABEL}=${marks.installation}`,
    '--label',
    `${KIND_LABEL}=${marks.kind}`,
    '--label',
    `${SUBJECT_LABEL}=${marks.subject}`,
  ];
}

export type GuestConfiguration = {
  readonly network: string;
  readonly user: string;
  readonly readOnlyRoot: boolean;
  readonly capabilitiesDropped: readonly string[];
  readonly securityOptions: readonly string[];
  readonly pids: number;
  readonly memoryBytes: number;
  readonly nanoCpus: number;
  readonly mounts: readonly { readonly type: string; readonly source: string; readonly destination: string }[];
  readonly tmpfs: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
};

export function workloadMismatch(
  actual: GuestConfiguration,
  expected: { readonly limits: GuestLimits; readonly volume: string },
): string | null {
  if (actual.labels[KIND_LABEL] !== undefined && actual.labels[KIND_LABEL] !== 'workload') {
    return `it is a ${actual.labels[KIND_LABEL]} container, which no workload is admitted to`;
  }
  if (actual.network !== 'none') return `it runs on the ${actual.network} network rather than none`;
  if (actual.user !== GUEST_USER) return `it runs as ${actual.user || 'root'} rather than ${GUEST_USER}`;
  if (!actual.readOnlyRoot) return 'its image root is writable';
  if (!actual.capabilitiesDropped.includes('ALL')) return 'it keeps capabilities the boundary drops';
  if (!actual.securityOptions.some((option) => option.includes('no-new-privileges'))) {
    return 'it may gain privileges its boundary forbids';
  }
  const mounted = actual.mounts.filter((mount) => mount.destination === GUEST_TREE);
  if (mounted.length !== 1 || mounted[0]?.type !== 'volume' || mounted[0]?.source !== expected.volume) {
    return `its tree is not the private volume ${expected.volume}`;
  }
  const foreign = actual.mounts.find((mount) => mount.destination !== GUEST_TREE);
  if (foreign !== undefined) return `it carries a ${foreign.type} mount at ${foreign.destination}`;
  for (const place of [GUEST_TMP, GUEST_HOME]) {
    if (!actual.tmpfs.includes(place)) return `${place} is not the temporary filesystem the boundary names`;
  }
  if (actual.pids !== expected.limits.pids) {
    return `it may hold ${actual.pids} processes rather than the ${expected.limits.pids} recorded`;
  }
  const memory = memoryBytes(expected.limits.memory);
  if (memory === null) return `its recorded memory ceiling ${expected.limits.memory} is not a ceiling`;
  if (actual.memoryBytes !== memory) {
    return `it may take ${actual.memoryBytes} bytes of memory rather than the ${memory} recorded`;
  }
  const cpus = nanoCpus(expected.limits.cpus);
  if (cpus === null) return `its recorded cpu ceiling ${expected.limits.cpus} is not a ceiling`;
  if (actual.nanoCpus !== cpus) return `it may take ${actual.nanoCpus / 1e9} cpus rather than the ${expected.limits.cpus} recorded`;
  return null;
}

export function memoryBytes(spec: string): number | null {
  const said = /^(\d+(?:\.\d+)?)\s*([bkmg])?$/i.exec(spec.trim());
  if (said === null) return null;
  const size = Number(said[1]);
  const scale = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[(said[2] ?? 'b').toLowerCase()] ?? 1;
  return Math.round(size * scale);
}

export function nanoCpus(spec: string): number | null {
  const cpus = Number(spec.trim());
  return Number.isFinite(cpus) && cpus > 0 ? Math.round(cpus * 1e9) : null;
}
