import { Effect } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { output } from '../cut/command.js';
import type { PlatformTrouble } from '../cut/platform.js';
import { type Target, targetName } from '../cut/target.js';

export const TARGETS: readonly Target[] = [
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'x64' },
];

export const runtimeName = (target: Target): string => `bun-darwin-${target.arch === 'arm64' ? 'aarch64' : 'x64'}`;

const rustTriple = (target: Target): string => `${target.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;

export const machineTarget = (): Target | null =>
  process.platform === 'darwin' && (process.arch === 'arm64' || process.arch === 'x64') ? { os: 'darwin', arch: process.arch } : null;

export const targetTrouble = Effect.fn('release.target')(function* (
  target: Target,
  cwd: string,
): Effect.fn.Return<PlatformTrouble | null, never, ChildProcessSpawner.ChildProcessSpawner> {
  const here = machineTarget();
  const name = targetName(target);
  if (here === null) return { detail: `a release is cut on macOS, and this machine is ${process.platform}-${process.arch}`, unblock: [] };
  if (target.arch !== here.arch && here.arch === 'x64') {
    return { detail: `a ${name} release is cut and tried on Apple silicon, and this Mac is Intel`, unblock: [] };
  }
  const triple = rustTriple(target);
  const installed = yield* output('rustup', ['target', 'list', '--installed'], cwd, {}).pipe(
    Effect.catchTag('CommandUnavailable', () => Effect.succeed(null)),
  );
  if (installed === null || installed.status !== 0) {
    return {
      detail: `rustup could not tell which Rust targets stand here, and the execution host and the watch engine of ${name} are built for ${triple}`,
      unblock: [`install Rust with rustup (https://rustup.rs), then rustup target add ${triple}`],
    };
  }
  if (!installed.text.split('\n').some((line) => line.trim() === triple)) {
    return {
      detail: `Rust has no ${triple} target here, so the execution host and the watch engine of ${name} cannot be built`,
      unblock: [`rustup target add ${triple}, then cut the release again`],
    };
  }
  if (target.arch === here.arch) return null;
  const rosetta = yield* output('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], cwd, {}).pipe(
    Effect.map((ran) => ran.status === 0),
    Effect.catchTag('CommandUnavailable', () => Effect.succeed(false)),
  );
  if (rosetta) return null;
  return {
    detail: `Rosetta is not installed, and the ${name} release is checked and tried under it on this Mac`,
    unblock: ['softwareupdate --install-rosetta --agree-to-license, then cut the release again'],
  };
});
