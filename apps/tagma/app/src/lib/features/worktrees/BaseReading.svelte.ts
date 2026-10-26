import type { CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import type { LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';

export function baseOf(row: Pick<WorktreePlace, 'base'> | null): string | null {
  if (row === null || row.base === null) return null;
  return row.base.branch === null ? row.base.commit : `refs/heads/${row.base.branch}`;
}

export function baseName(row: Pick<WorktreePlace, 'base'> | null): string {
  if (row === null || row.base === null) return 'its base';
  return row.base.branch ?? row.base.commit.slice(0, 7);
}

export class BaseReading {
  row = $state.raw<CheckoutState | null>(null);
  unread = $state<string | null>(null);

  private held: { unsubscribe: () => void } | null = null;
  private opened: string | null = null;

  constructor(
    private readonly live: LiveConnection,
    private readonly projectId: number,
    private readonly onFrame?: () => void,
  ) {}

  aim(rootId: string | null, base: string | null): void {
    const key = rootId === null ? null : `${rootId}\u0000${base ?? ''}`;
    if (key === this.opened) return;
    this.close();
    this.opened = key;
    if (rootId === null) return;
    this.held = this.live.hold(
      (client) => client['checkout.subscribe']({ projectId: this.projectId, root: rootId, base: base ?? undefined }),
      (frame) => {
        this.row = frame;
        this.unread = null;
        this.onFrame?.();
      },
      (reason) => {
        if (reason.kind !== 'subscription') return;
        this.unread = refusalOf({ code: reason.code ?? 'http', reason: reason.message, unblock: reason.unblock ?? [] }).reason;
      },
    );
  }

  close(): void {
    this.held?.unsubscribe();
    this.held = null;
    this.opened = null;
    this.row = null;
    this.unread = null;
  }
}
