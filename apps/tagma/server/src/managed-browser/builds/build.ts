import { Data, type Effect } from 'effect';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import type { BuildId } from '../contract/wire/document.js';

export class BuildUnavailable extends Data.TaggedError('BuildUnavailable')<{ readonly message: string; readonly unblock: Unblock }> {}

export type Launch = {
  readonly executable: string;
  readonly args: (profileDir: string) => readonly string[];
};

export type Build = {
  readonly id: BuildId;
  readonly launch: Effect.Effect<Launch, BuildUnavailable>;
};
