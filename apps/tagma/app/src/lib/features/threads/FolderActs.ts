import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { ThreadsRepo } from './Repo.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;

export type FolderRemoved = {
  readonly removed: readonly string[];
  readonly released: readonly { readonly threadId: string; readonly folderId: string }[];
};

export class FolderActs extends Service<FolderActs>()('FolderActs', { tier: 'project' }) {
  static *make() {
    return new FolderActs(yield* ProjectRung.Current, yield* ThreadsRepo, yield* Scope, yield* Failure);
  }

  private era = 0;

  constructor(
    private readonly aim: ProjectAim,
    private readonly repo: Threads,
    life: Scope,
    private readonly failure: Failure,
  ) {
    super();
    life.defer(() => {
      this.era += 1;
    });
  }

  async file(threadIds: readonly string[], folderId: string | null): Promise<boolean> {
    const answer = await this.run(() => this.repo.file.run({ projectId: this.aim.projectId, threadIds, folderId }, { throwOnError: true }));
    return answer !== null;
  }

  async create(name: string, threadIds: readonly string[], parentId: string | null = null): Promise<ThreadFolder | null> {
    const answer = await this.run(() =>
      this.repo.createFolder.run({ projectId: this.aim.projectId, name, parentId, threadIds }, { throwOnError: true }),
    );
    return answer?.folder ?? null;
  }

  async rename(folderId: string, name: string): Promise<boolean> {
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (trimmed === '') return false;
    const answer = await this.run(() =>
      this.repo.renameFolder.run({ projectId: this.aim.projectId, folderId, name: trimmed }, { throwOnError: true }),
    );
    return answer !== null;
  }

  async move(folderId: string, parentId: string | null, index: number): Promise<boolean> {
    const answer = await this.run(() =>
      this.repo.moveFolder.run({ projectId: this.aim.projectId, folderId, parentId, index }, { throwOnError: true }),
    );
    return answer !== null;
  }

  async remove(folderId: string): Promise<FolderRemoved | null> {
    const answer = await this.run(() => this.repo.deleteFolder.run({ projectId: this.aim.projectId, folderId }, { throwOnError: true }));
    return answer === null ? null : { removed: answer.removed, released: answer.released };
  }

  private async run<A>(work: () => Promise<A | undefined>): Promise<A | null> {
    const era = this.era;
    try {
      const answer = await work();
      return era === this.era ? (answer ?? null) : null;
    } catch (error) {
      if (era === this.era) this.failure.report(error);
      return null;
    }
  }
}
