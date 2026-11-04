import type { ArtifactAdapter } from '../../Artifact';

const triples: Readonly<Record<string, string>> = { arm64: 'aarch64-unknown-linux-gnu', x64: 'x86_64-unknown-linux-gnu' };

export const artifactAdapter: ArtifactAdapter = {
  os: 'linux',
  workers: ['src/posix/linux/processes.linux.worker.ts'],
  artifact: (arch) => ({
    platform: { os: 'linux', arch },
    endpoint: { transport: 'unix', path: 'host.sock' },
    library: 'libexecution_platform.so',
    holder: 'execution-holder',
    triple: triples[arch],
    seal: () => ({ _tag: 'Refused', detail: 'this platform has no code-signing adapter' }),
  }),
};
