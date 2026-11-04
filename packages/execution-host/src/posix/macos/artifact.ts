import { signCode } from '@runlith/codesign/codesign';
import type { ArtifactAdapter } from '../../Artifact';

const triples: Readonly<Record<string, string>> = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };

export const artifactAdapter: ArtifactAdapter = {
  os: 'darwin',
  workers: ['src/posix/macos/processes.worker.ts'],
  artifact: (arch) => ({
    platform: { os: 'darwin', arch },
    endpoint: { transport: 'unix', path: 'host.sock' },
    library: 'libexecution_platform.dylib',
    holder: 'execution-holder',
    triple: triples[arch],
    seal: signCode,
  }),
};
