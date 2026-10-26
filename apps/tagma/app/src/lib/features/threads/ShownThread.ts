import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { ThreadIdentity } from './List.svelte.js';
import type { ThreadLease } from './thread/ThreadLease.js';

export class ShownThread {
  constructor(
    readonly projectId: number,
    private readonly active: () => string | null,
    private readonly leased: () => ThreadLease | null,
    private readonly identified: () => ThreadIdentity | null,
    private readonly harnessRow: () => ThreadListRow | null,
  ) {}

  get id(): string | null {
    return this.active();
  }

  get lease(): ThreadLease | null {
    return this.leased();
  }

  get identity(): ThreadIdentity | null {
    return this.identified();
  }

  get row(): ThreadListRow | null {
    return this.harnessRow();
  }
}
