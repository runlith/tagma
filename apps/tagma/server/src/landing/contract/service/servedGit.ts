import { Context, type Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';

export type LandingGitRequest = {
  readonly projectId: number;
  readonly thread: ThreadId;
  readonly root: string;
  readonly toolCall?: string;
};

export class LandingGit extends Context.Service<
  LandingGit,
  {
    readonly run: (request: LandingGitRequest, platform: Git['Service']) => Effect.Effect<Git['Service'], StoreFailure>;
  }
>()('tagma/landing/LandingGit') {}
