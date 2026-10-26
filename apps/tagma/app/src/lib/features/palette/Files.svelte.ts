import type { FoundFile } from '@tagma/server/checkout-files/contract/wire/paths';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { Door } from '$lib/wire/Door.js';
import { Refusal } from '$lib/wire/refusal.js';

export type FilesAim = {
  readonly projectId: number;
  readonly root: RootId;
  readonly rootPath: string;
  readonly recent: readonly string[];
};

export type FileTarget = {
  readonly query: string;
  readonly line: number | null;
  readonly column: number | null;
};

const TAIL = /^(.*?)(?::(\d+)(?::(\d+))?)?$/;

export function fileTargetOf(text: string): FileTarget {
  const hit = TAIL.exec(text.trim());
  const query = hit?.[1] ?? text.trim();
  return {
    query,
    line: hit?.[2] === undefined ? null : Number(hit[2]),
    column: hit?.[3] === undefined ? null : Number(hit[3]),
  };
}

export class FilesFeed {
  rows = $state.raw<readonly FoundFile[]>([]);
  matched = $state(0);
  loading = $state(false);
  failure = $state.raw<unknown>(null);

  private last: string | null = null;
  private turn = 0;
  private pending: AbortController | null = null;

  constructor(private readonly door: Door) {}

  ask(aim: FilesAim, query: string): void {
    const asked = `${aim.projectId}\u0000${aim.root}\u0000${query}`;
    if (asked === this.last) return;
    if (this.last !== null && !this.last.startsWith(`${aim.projectId}\u0000${aim.root}\u0000`)) {
      this.rows = [];
      this.matched = 0;
    }
    this.last = asked;
    const turn = this.supersede();
    this.loading = true;
    const pending = new AbortController();
    this.pending = pending;
    void this.door
      .perform('find_files', { root: aim.root, query, recent: aim.recent }, { project: String(aim.projectId) }, { signal: pending.signal })
      .then((answer) => {
        if (turn !== this.turn) return;
        this.rows = answer.files;
        this.matched = answer.matched;
        this.failure = null;
      })
      .catch((error: unknown) => {
        if (turn !== this.turn || pending.signal.aborted || (error instanceof Refusal && error.code === 'superseded')) return;
        this.rows = [];
        this.matched = 0;
        this.failure = error;
      })
      .finally(() => {
        if (turn === this.turn) this.loading = false;
      });
  }

  clear(): void {
    this.last = null;
    this.supersede();
    this.rows = [];
    this.matched = 0;
    this.failure = null;
    this.loading = false;
  }

  private supersede(): number {
    this.turn += 1;
    this.pending?.abort();
    this.pending = null;
    return this.turn;
  }
}
