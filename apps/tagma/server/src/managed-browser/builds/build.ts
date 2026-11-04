import type { Failure } from '@runlith/chrome-for-testing/launch/platform';
import { Data, type Effect } from 'effect';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import type { BuildId, WindowMode } from '../contract/wire/document.js';

export class BuildUnavailable extends Data.TaggedError('BuildUnavailable')<{ readonly message: string; readonly unblock: Unblock }> {
  static startup(build: string, failure: Failure): BuildUnavailable {
    return new BuildUnavailable({ message: `${build} is not available: ${failure.message}`, unblock: failure.unblock });
  }
}

export type Launch = {
  readonly executable: string;
  readonly args: (profileDir: string, window: WindowMode) => readonly string[];
};

export type Build = {
  readonly id: BuildId;
  readonly launch: Effect.Effect<Launch, BuildUnavailable>;
};
