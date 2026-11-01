import type { Resolver } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import type { StagedItem, StagedKind } from '$lib/shared/threads/staged.js';

export class StagedItems {
  constructor(
    private readonly kinds: Point<StagedKind>,
    private readonly app: Resolver,
    private readonly projectId: number,
  ) {}

  async file(item: StagedItem): Promise<File | null> {
    const kind = this.kinds.find(item.kind);
    return kind === undefined ? null : kind.file(this.app, item);
  }

  noted(item: StagedItem): boolean {
    return this.kinds.find(item.kind)?.sent !== undefined;
  }

  async sent(item: StagedItem, threadId: string): Promise<void> {
    await this.kinds.find(item.kind)?.sent?.(this.app, item, { id: threadId, projectId: this.projectId });
  }
}
