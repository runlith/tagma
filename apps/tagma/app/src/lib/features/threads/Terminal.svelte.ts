import type { HarnessRowDetail } from '@tagma/server/threads/contract/wire/harness/externalSession';
import { TerminalPane } from '$lib/features/executions/terminal/Pane.svelte.js';
import type { ChildEnding } from '$lib/features/executions/terminal/RecordStream.svelte.js';
import { heldOf } from '$lib/features/executions/terminal/Holders.svelte.js';
import type { TerminalViews, ViewLease } from '$lib/features/executions/terminal/Views.svelte.js';
import { ExecutionsRepo, type ExecutionAddress } from '$lib/features/executions/Repo.js';
import type { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import type { HarnessOpenAttempt } from './OpenWatch.js';

export type PaneSettings = {
  writeGrid(projectId: number, grid: { readonly cols: number; readonly rows: number }): Promise<void>;
};

export type PaneState =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly problem: string }
  | { readonly kind: 'replacing' }
  | { readonly kind: 'restoring'; readonly done: number; readonly total: number | null }
  | { readonly kind: 'live' }
  | { readonly kind: 'lostFeed' }
  | { readonly kind: 'ended'; readonly ending: ChildEnding | null }
  | { readonly kind: 'failed'; readonly failure: string }
  | { readonly kind: 'uncertain'; readonly failure: string | null };

export type ThreadTerminalBirth = {
  readonly threadId: string;
  readonly projectId: number;
  readonly execution?: ExecutionAddress | null;
  readonly harness?: () => HarnessRowDetail | null;
  readonly attempt?: HarnessOpenAttempt | null;
};

type ReadAnswer =
  | { readonly kind: 'none' }
  | { readonly kind: 'read' }
  | { readonly kind: 'unreadable'; readonly problem: string }
  | { readonly kind: 'replacing' };

const REPLACED = 'being replaced';

const readFailure = (error: unknown): ReadAnswer => {
  const refusal = refusalOf(error);
  return refusal.code === 'terminal-host-state' && refusal.reason.includes(REPLACED)
    ? { kind: 'replacing' }
    : { kind: 'unreadable', problem: refusal.reason };
};

const sameAddress = (one: ExecutionAddress, other: ExecutionAddress): boolean =>
  one.execution === other.execution && one.incarnation === other.incarnation;

export class ThreadTerminal {
  constructor(
    private readonly threadId: string,
    private readonly projectId: number,
    aim: ExecutionAddress | null,
    private readonly harness: () => HarnessRowDetail | null,
    private readonly timed: HarnessOpenAttempt | null,
    private readonly repo: ExecutionsRepo,
    private readonly panes: TerminalViews,
    live: LiveConnection,
    commands: CommandActivity,
    private readonly settings: PaneSettings | null = null,
  ) {
    this.aim = aim;
    this.releaseReading = commands.onReading(() => this.recover());
    this.releaseStatus = live.subscribeStatus((status) => {
      if (status === 'open') this.recover();
    });
  }

  pane = $state<TerminalPane | null>(null);
  state = $derived.by<PaneState>(() => this.decide());

  private aim: ExecutionAddress | null = null;
  private lease: ViewLease | null = null;
  private answer = $state.raw<ReadAnswer>({ kind: 'none' });
  private closed = $state(false);
  private closedOver: ExecutionAddress | null = null;
  private dropped = false;
  private reading = false;
  private reread = false;
  private readonly releaseReading: () => void;
  private readonly releaseStatus: () => void;
  private releaseSettled: (() => void) | null = null;
  private gridWrites: Promise<void> = Promise.resolve();

  async read(address?: ExecutionAddress | null): Promise<void> {
    if (address !== undefined) {
      const put = this.closedOver;
      if (address !== null && (put === null || !sameAddress(put, address))) this.closed = false;
      const held = this.aim;
      if (address === null || held === null || !sameAddress(held, address)) this.answer = { kind: 'none' };
      this.aim = address;
    }
    if (this.closed || this.dropped) return;
    if (this.adoptedEnded()) {
      this.release();
      return;
    }
    const aim = this.aim;
    this.lease ??= this.panes.holding(this.threadId);
    const standing = this.lease?.pane ?? null;
    if (standing !== null) {
      this.pane = standing;
      this.followSettled(standing);
      if (aim !== null && standing.address !== null && sameAddress(standing.address, aim)) {
        this.answer = { kind: 'read' };
        this.reportStanding(standing);
        return;
      }
    }
    if (aim === null) return;
    if (this.reading) return;
    this.reading = true;
    try {
      for (;;) {
        const next = this.aim;
        if (next === null || this.closed || this.dropped) return;
        this.reread = false;
        await this.readOnce(next);
        if (this.dropped) return;
        const moved = this.aim;
        if (moved === null || this.closed || (sameAddress(moved, next) && (this.answer.kind === 'read' || !this.reread))) return;
      }
    } finally {
      this.reading = false;
    }
  }

  private recover(): void {
    if (this.reading) this.reread = true;
    else if (this.answer.kind === 'unreadable' || this.answer.kind === 'replacing') void this.read();
  }

  close(): void {
    this.closed = true;
    this.closedOver = this.aim;
    this.pane = null;
    this.unlease();
    this.panes.forget(this.threadId);
  }

  drop(): void {
    this.dropped = true;
    this.releaseReading();
    this.releaseStatus();
    this.releaseSettled?.();
    this.releaseSettled = null;
    this.pane = null;
    this.unlease();
  }

  private unlease(): void {
    this.lease?.release();
    this.lease = null;
  }

  private async readOnce(aim: ExecutionAddress): Promise<void> {
    let listing;
    try {
      listing = await this.repo.record.key(aim).refresh({ throwOnError: true });
    } catch (error) {
      if (!this.dropped && !this.closed && this.aim !== null && sameAddress(this.aim, aim)) this.answer = readFailure(error);
      return;
    }
    if (this.dropped || this.closed || this.aim === null || !sameAddress(this.aim, aim) || listing === undefined || this.adoptedEnded())
      return;
    this.timed?.reached('record', performance.now());
    this.answer = { kind: 'read' };
    const record = listing.record;
    this.raise(aim, record.program ?? 'shell', record.cwd ?? '');
    this.pane?.heldBy(aim, heldOf(record));
  }

  private raise(aim: ExecutionAddress, program: string, root: string): void {
    const standing = this.pane;
    if (standing !== null) {
      standing.bind(aim);
      return;
    }
    this.unlease();
    this.lease = this.panes.lease(this.threadId, {
      projectId: this.projectId,
      root,
      address: aim,
      program,
    });
    const pane = this.lease.pane;
    this.pane = pane;
    this.followSettled(pane);
    this.timed?.reached('engine', performance.now());
    this.timed?.reached('attach', performance.now());
    if (this.timed !== null) void this.watchPaint(this.timed, pane);
  }

  private followSettled(pane: TerminalPane): void {
    this.releaseSettled?.();
    const settings = this.settings;
    this.releaseSettled =
      settings === null
        ? null
        : pane.onSettled((grid) => {
            this.gridWrites = this.gridWrites.then(() => settings.writeGrid(this.projectId, grid)).catch(() => undefined);
          });
  }

  private reportStanding(pane: TerminalPane): void {
    const attempt = this.timed;
    if (attempt === null || pane.paintedAt === null) return;
    const at = performance.now();
    attempt.reached('replay', at);
    attempt.reached('paint', at);
  }

  private async watchPaint(attempt: HarnessOpenAttempt, pane: TerminalPane): Promise<void> {
    while (!this.dropped && attempt.paintAt === null && attempt.cancelDeadline !== null) {
      if (attempt.replayAt === null && pane.replayedAt !== null) attempt.reached('replay', pane.replayedAt);
      if (pane.paintedAt !== null) attempt.reached('paint', pane.paintedAt);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  settle(): void {
    const pane = this.pane;
    if (this.harness()?.process?.state !== 'ended') return;
    if (this.adoptedEnded()) {
      this.release();
      return;
    }
    if (pane === null) return;
    pane.end(pane.ending ?? { _tag: 'None' });
  }

  private adoptedEnded(): boolean {
    const process = this.harness()?.process ?? null;
    return process !== null && process.origin === 'adopted' && process.state === 'ended';
  }

  private release(): void {
    this.releaseSettled?.();
    this.releaseSettled = null;
    this.pane = null;
    this.unlease();
    this.panes.forget(this.threadId);
  }

  private decide(): PaneState {
    if (this.closed) return { kind: 'absent' };
    const harness = this.harness();
    const pane = this.pane;
    const process = harness?.process ?? null;
    const bare = (harness?.execution ?? null) === null;
    if (process !== null && process.state === 'ended') {
      return bare && process.failure !== undefined
        ? { kind: 'failed', failure: process.failure }
        : { kind: 'ended', ending: pane?.ending ?? null };
    }
    if (bare && process !== null && process.state === 'uncertain') return { kind: 'uncertain', failure: process.failure ?? null };
    const answer = this.answer;
    if (answer.kind === 'replacing') return { kind: 'replacing' };
    if (answer.kind === 'unreadable') return { kind: 'unreadable', problem: answer.problem };
    if (pane !== null) {
      if (pane.ending !== null) {
        const named = harness?.execution ?? null;
        const superseded = process !== null && (named === null || pane.address === null || !sameAddress(named, pane.address));
        return superseded ? { kind: 'connecting' } : { kind: 'ended', ending: pane.ending };
      }
      if (pane.recovering) return { kind: 'lostFeed' };
      return pane.replayedAt === null ? { kind: 'restoring', done: pane.replayedBytes, total: pane.replayedTotal } : { kind: 'live' };
    }
    return { kind: 'connecting' };
  }
}
