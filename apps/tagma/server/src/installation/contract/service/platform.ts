import { Data, type Effect } from 'effect';
import type { InstallationPlatform } from '../wire/manifest.js';

export class PlatformUnreadable extends Data.TaggedError('PlatformUnreadable')<{ readonly reason: string }> {}

export type MachinePlatform = {
  readonly current: Effect.Effect<InstallationPlatform, PlatformUnreadable>;
};
