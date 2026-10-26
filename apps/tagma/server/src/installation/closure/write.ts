import { Effect, FileSystem, type PlatformError, Schema } from 'effect';
import { INSTALL_FILE } from '../contract/wire/layout.js';
import {
  InstallationManifest,
  type InstallationPart,
  type InstallationPlatform,
  type InstallationProvenance,
  InstallationUnreadable,
  type IrreversibleChange,
} from '../contract/wire/manifest.js';
import { identityOf, partPath } from './read.js';

const encodeManifest = Schema.encodeSync(Schema.fromJsonString(InstallationManifest, { space: 2 }));

export const writeInstallation = Effect.fn('installation.write')(function* (
  root: string,
  platform: InstallationPlatform,
  build: string,
  parts: ReadonlyArray<InstallationPart>,
  origin?: InstallationProvenance,
  tree?: string,
  irreversible?: ReadonlyArray<IrreversibleChange>,
) {
  const files = yield* FileSystem.FileSystem;
  const manifest: InstallationManifest = {
    version: 1,
    identity: { digest: identityOf({ platform, parts }), build, tree },
    platform,
    origin,
    irreversible,
    parts,
  };
  yield* files.writeFileString(partPath(root, INSTALL_FILE), encodeManifest(manifest), { mode: 0o600 }).pipe(
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
      Effect.fail(
        new InstallationUnreadable({
          root,
          role: 'server',
          path: INSTALL_FILE,
          detail: `it could not be written: ${error.reason._tag}`,
        }),
      ),
    ),
  );
  return manifest;
});
