import type { MountedApp } from '@runlith/layer/App';
import { Handoff } from '@runlith/layer/Handoff';
import { untrack } from 'svelte';
import { ProjectRung } from '../workspace/ProjectRung.js';
import { Workspace } from '../workspace/Selection.svelte.js';
import { TileRung } from '../workspace/TileRung.js';
import { ThreadList } from '../threads/List.svelte.js';
import { onThreadOpen, type ThreadOpenTiming } from '../threads/threadOpenRecord.js';

export const PROJECT_SWITCH = 'tagma.project-switch';
export const PROJECT_SWITCH_TALLY = 'tagma.project-switch.tally';

export type ProjectSwitchTiming = {
  readonly projectId: number;
  readonly project: string;
  readonly from: { readonly navigation: string; readonly entry: string | null };
  readonly warm: boolean;
  readonly navigationMs: number | null;
  readonly scopeMs: number | null;
  readonly listMs: number | null;
  readonly threadMs: number | null;
  readonly thread: ThreadOpenTiming | null;
  readonly frameMs: number | null;
  readonly totalMs: number;
};

export type ProjectSwitchTally = {
  measured: number;
  unfinished: number;
  dropped: number;
  declined: number;
  reasons: { superseded: number; closed: number; scope: number };
};

const KEPT = 64;
const entries = new Set<{ readonly projectId: number; readonly entry: string }>();

export function markProjectSwitch(projectId: number, entry: string): () => void {
  const mark = { projectId, entry };
  entries.add(mark);
  return () => void entries.delete(mark);
}

export function projectSwitches(): readonly PerformanceMeasure[] {
  return performance.getEntriesByName(PROJECT_SWITCH, 'measure') as PerformanceMeasure[];
}

export function projectSwitchTally(): ProjectSwitchTally {
  const mark = performance.getEntriesByName(PROJECT_SWITCH_TALLY, 'mark').at(-1) as PerformanceMark | undefined;
  const standing = mark?.detail as ProjectSwitchTally | undefined;
  return standing === undefined
    ? { measured: 0, unfinished: 0, dropped: 0, declined: 0, reasons: { superseded: 0, closed: 0, scope: 0 } }
    : { ...standing, reasons: { ...standing.reasons } };
}

function writeTally(tally: ProjectSwitchTally): void {
  performance.clearMarks(PROJECT_SWITCH_TALLY);
  performance.mark(PROJECT_SWITCH_TALLY, { detail: tally });
}

type Destination = { readonly projectId: number; readonly project: string; threadId: string | null };
type Attempt = Destination & {
  readonly warm: boolean;
  readonly startedAt: number;
  readonly from: ProjectSwitchTiming['from'];
  navigationAt: number | null;
  scopeAt: number | null;
  listAt: number | null;
  threadAt: number | null;
  thread: ThreadOpenTiming | null;
  scopeAsked: boolean;
  frame: number | null;
};

export class ProjectSwitchWatch {
  constructor(private readonly app: MountedApp) {}

  private attempt: Attempt | null = null;
  private readonly stop = onThreadOpen((timing) => {
    const attempt = this.attempt;
    if (attempt === null || timing.threadId !== attempt.threadId) return;
    attempt.threadAt ??= performance.now();
    attempt.thread ??= timing;
    if (timing.kind === 'chat' ? timing.reached !== 'frame' : timing.paintMs === null) this.write(attempt, null);
    else this.frame(attempt);
  });

  begin(destination: Destination | null, navigation: string, startedAt = performance.now()): void {
    this.decline('superseded');
    if (destination === null) return;
    const marks = [...entries].filter((mark) => mark.projectId === destination.projectId);
    for (const mark of marks) entries.delete(mark);
    this.attempt = {
      ...destination,
      warm: this.app.hasScope(TileRung, { tileId: this.app.resolve(Workspace).tileIdOf(destination.projectId) }),
      startedAt,
      from: { navigation, entry: marks.at(-1)?.entry ?? null },
      navigationAt: null,
      scopeAt: null,
      listAt: null,
      threadAt: null,
      thread: null,
      scopeAsked: false,
      frame: null,
    };
  }

  navigated(project: string | undefined, threadId?: string | null): void {
    const attempt = this.attempt;
    if (attempt === null || attempt.project !== project) return;
    if (threadId !== undefined && threadId !== attempt.threadId) {
      attempt.threadId = threadId;
      attempt.thread = null;
      attempt.threadAt = null;
    }
    attempt.navigationAt ??= performance.now();
    this.follow();
    this.frame(attempt);
  }

  follow(): void {
    const aim = this.app.resolve(ProjectRung.Source)();
    if (aim === undefined) return;
    const list = this.app.find(ThreadList);
    const listed = list instanceof ThreadList && list.roots !== null;
    untrack(() => {
      this.scope(aim.projectId);
      if (listed) this.listed(aim.projectId);
    });
  }

  private scope(projectId: number): void {
    const attempt = this.attempt;
    if (attempt === null || attempt.projectId !== projectId || attempt.scopeAsked) return;
    attempt.scopeAsked = true;
    void this.app
      .resolve(Handoff)
      .ready(ProjectRung, { projectId })
      .then(
        () => {
          if (this.attempt !== attempt) return;
          attempt.scopeAt = performance.now();
          this.frame(attempt);
        },
        (error: unknown) => {
          if (this.attempt !== attempt) return;
          this.decline('scope');
          this.app.failure.report(error);
        },
      );
  }

  private listed(projectId: number): void {
    const attempt = this.attempt;
    if (attempt === null || attempt.projectId !== projectId) return;
    attempt.listAt ??= performance.now();
    this.frame(attempt);
  }

  close(): void {
    this.decline('closed');
    this.stop();
  }

  private decline(reason: keyof ProjectSwitchTally['reasons']): void {
    if (this.attempt === null) return;
    if (this.attempt.frame !== null) cancelAnimationFrame(this.attempt.frame);
    this.attempt = null;
    const tally = projectSwitchTally();
    tally.declined += 1;
    tally.reasons[reason] += 1;
    writeTally(tally);
  }

  private frame(attempt: Attempt): void {
    if (attempt.frame !== null || attempt.navigationAt === null || attempt.scopeAt === null || attempt.listAt === null) return;
    if (attempt.threadId !== null && attempt.thread === null) return;
    attempt.frame = requestAnimationFrame(() => {
      if (this.attempt === attempt) this.write(attempt, performance.now());
    });
  }

  private write(attempt: Attempt, framedAt: number | null): void {
    if (attempt.frame !== null) cancelAnimationFrame(attempt.frame);
    this.attempt = null;
    const totalMs = (framedAt ?? performance.now()) - attempt.startedAt;
    const timing: ProjectSwitchTiming = {
      projectId: attempt.projectId,
      project: attempt.project,
      from: attempt.from,
      warm: attempt.warm,
      navigationMs: attempt.navigationAt === null ? null : attempt.navigationAt - attempt.startedAt,
      scopeMs: attempt.scopeAt === null ? null : attempt.scopeAt - attempt.startedAt,
      listMs: attempt.listAt === null ? null : attempt.listAt - attempt.startedAt,
      threadMs: attempt.threadAt === null ? null : attempt.threadAt - attempt.startedAt,
      thread: attempt.thread,
      frameMs: framedAt === null ? null : totalMs,
      totalMs,
    };
    performance.measure(PROJECT_SWITCH, { detail: timing, start: attempt.startedAt, duration: totalMs });
    const tally = projectSwitchTally();
    tally.measured += 1;
    if (framedAt === null) tally.unfinished += 1;
    const standing = projectSwitches();
    if (standing.length > KEPT * 2) {
      const newest = standing.slice(-KEPT).map((entry) => ({ detail: entry.detail, start: entry.startTime, duration: entry.duration }));
      performance.clearMeasures(PROJECT_SWITCH);
      for (const entry of newest) performance.measure(PROJECT_SWITCH, entry);
      tally.dropped += standing.length - newest.length;
    }
    writeTally(tally);
  }
}
