import type { Effect } from 'effect';
import type { ThreadRewindScope } from '@runlith/agent/transcript/eventFold';
import type { ThreadsRepo } from '../Repo.js';
import { answered, type ThreadRefused } from '../thread/ThreadRefused.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;

type Answer<Call extends (...args: never[]) => Promise<unknown>> = Effect.Effect<
  Exclude<Awaited<ReturnType<Call>>, undefined>,
  ThreadRefused
>;

export class RewindOps {
  constructor(
    private readonly threads: Threads,
    private readonly projectId: number,
  ) {}

  points(id: string): Answer<Threads['rewindPoints']['run']> {
    return answered(() => this.threads.rewindPoints.run({ id, projectId: this.projectId }, { throwOnError: true }));
  }

  preview(id: string, runId: string, scope: ThreadRewindScope): Answer<Threads['previewRewind']['run']> {
    return answered(() => this.threads.previewRewind.run({ id, projectId: this.projectId, at: runId, scope }, { throwOnError: true }));
  }

  rewind(id: string, runId: string, scope: ThreadRewindScope, revertLines: boolean): Answer<Threads['rewind']['run']> {
    return answered(() =>
      this.threads.rewind.run(
        { id, projectId: this.projectId, at: runId, scope, revertLines, key: crypto.randomUUID() },
        { throwOnError: true },
      ),
    );
  }

  restore(id: string, rewindId: string): Answer<Threads['restore']['run']> {
    return answered(() =>
      this.threads.restore.run({ id, projectId: this.projectId, rewindId, key: crypto.randomUUID() }, { throwOnError: true }),
    );
  }

  branch(id: string, runId: string): Answer<Threads['branch']['run']> {
    return answered(() =>
      this.threads.branch.run({ id, projectId: this.projectId, before: runId, key: crypto.randomUUID() }, { throwOnError: true }),
    );
  }
}
