import { Effect } from 'effect';
import type { ReleasePlatform } from '../cut/platform.js';
import { hostBinary, hostBundle } from '../mac-applications/bundle.js';
import { diskImage } from './dmg.js';
import { appleNotary } from './notarize.js';
import { packRelease } from './packing.js';
import { sealRelease } from './sealing.js';
import { developerTeam, releaseIdentity, signingIdentity, signingNotice } from './signing.js';
import { machineTarget, runtimeName, TARGETS, targetTrouble } from './target.js';
import { trialStart } from './trial.js';

export const macRelease: ReleasePlatform = {
  refusal: (os) =>
    os === 'darwin' ? null : `a closure carries the macOS desktop application, which is built and signed on macOS; this machine is ${os}`,
  application: (channel) => ({ bundle: hostBundle(channel), binary: hostBinary(channel) }),
  signer: signingIdentity,
  releaseSigner: releaseIdentity,
  notice: signingNotice,
  seal: sealRelease,
  targets: TARGETS,
  native: machineTarget,
  trouble: targetTrouble,
  runtime: runtimeName,
  speech: ['install cmake and the Xcode command line tools on this Mac, then cut the release again'],
  pack: packRelease,
  image: {
    name: (channel, release, target) => `${channel.name}-${release}-${target.arch}.dmg`,
    make: (application, image, assets, volume, signer) =>
      diskImage(application, image, assets, volume, { identity: signer.fingerprint, timestamp: true }),
  },
  notary: (signer, assets, profile) => {
    const team = developerTeam(signer);
    return team === null
      ? Effect.fail({ detail: `"${signer.name}" names no Developer ID team`, unblock: [] })
      : appleNotary({ signing: { identity: signer.fingerprint, timestamp: true }, team, assets, profile });
  },
  trial: trialStart,
};
