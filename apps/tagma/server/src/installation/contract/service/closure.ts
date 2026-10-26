import { Context, type Effect } from 'effect';
import type {
  CurrentInstallation,
  InstallationFailure,
  InstallationManifest,
  InstallationPart,
  InstallationPlatform,
  InstallationProvenance,
  InstallationRole,
  InstallationUnreadable,
} from '../wire/manifest.js';

export class InstallationClosure extends Context.Service<
  InstallationClosure,
  {
    read(root: string): Effect.Effect<InstallationManifest, InstallationFailure>;
    verify(root: string): Effect.Effect<InstallationManifest, InstallationFailure>;
    current(entry: string, installed: string): Effect.Effect<CurrentInstallation, InstallationFailure>;
    write(
      root: string,
      platform: InstallationPlatform,
      build: string,
      parts: ReadonlyArray<InstallationPart>,
      origin?: InstallationProvenance,
      tree?: string,
    ): Effect.Effect<InstallationManifest, InstallationUnreadable>;
    parts(root: string, role: InstallationRole, relative: string): Effect.Effect<ReadonlyArray<InstallationPart>, InstallationUnreadable>;
  }
>()('tagma/installation/InstallationClosure') {}
