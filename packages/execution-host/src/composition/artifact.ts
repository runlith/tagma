import { artifactAdapter as macos } from '../posix/macos/artifact';
import { artifactAdapter as linux } from '../posix/linux/artifact';
import type { NativeArtifact } from '../Artifact';

const adapters = [macos, linux];

export const nativeWorkers = adapters.flatMap((adapter) => adapter.workers);

export const nativeArtifact = (arch: string = process.arch, os: string = process.platform): NativeArtifact | undefined =>
  adapters.find((adapter) => adapter.os === os)?.artifact(arch);
