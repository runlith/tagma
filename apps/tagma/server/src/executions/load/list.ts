import type { LoadGroup, LoadReading } from '@runlith/executions/protocol/evidence';
import { commandKey } from '../commands/feedDelta.js';
import {
  keptHistory,
  OWN_KINDS,
  type LoadExecution,
  type LoadPoint,
  type LoadProcess,
  type LoadProject,
  type LoadResidual,
  type LoadRow,
  type LoadRowKind,
  type LoadTotal,
  type LoadView,
} from '../contract/wire/load.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { BackgroundWork } from '../../platform/contract/wire/background.js';
import type { Named, Work } from './work.js';

const RANK_MS = 5_000;
const SATURATION_MS = 10_000;
const SATURATED = 0.9;
const MINOR = 0.005;
const TOP = 0.1;
const DRAWN = 0.0005;

const totalOf = (rows: readonly LoadRow[], reading: LoadReading): LoadTotal => ({
  count: rows.length,
  share: reading.overMicros === 0 ? null : rows.reduce((sum, row) => sum + row.share, 0),
  memoryBytes: reading.groups.length === 0 ? null : rows.reduce((sum, row) => sum + row.memoryBytes, 0),
  unread: rows.reduce((sum, row) => sum + row.unread, 0),
});

type Building = {
  readonly key: string;
  readonly kind: LoadRowKind;
  title: string;
  detail: string | undefined;
  readonly where: string | undefined;
  project: LoadProject | undefined;
  readonly thread: ThreadId | undefined;
  cores: number;
  memoryBytes: number;
  unread: number;
  readonly processes: LoadProcess[];
  readonly executions: LoadExecution[];
  readonly residuals: LoadResidual[];
  newest: { readonly work: Work; readonly ended: boolean } | undefined;
};

export class LoadList {
  private history: readonly LoadPoint[] = [];

  get points(): readonly LoadPoint[] {
    return this.history;
  }

  reset(): void {
    this.history = [];
  }

  compose(
    reading: LoadReading,
    named: Named,
    readAt: number,
    background: readonly BackgroundWork[],
  ): { readonly view: LoadView; readonly point: LoadPoint | undefined } {
    const cores = reading.cores;
    const built = new Map<string, Building>();
    const open = (key: string, kind: LoadRowKind, title: string, extra: Partial<Building> = {}): Building => {
      const standing = built.get(key);
      if (standing !== undefined) return standing;
      const fresh: Building = {
        key,
        kind,
        title,
        detail: undefined,
        where: undefined,
        project: undefined,
        thread: undefined,
        cores: 0,
        memoryBytes: 0,
        unread: 0,
        processes: [],
        executions: [],
        residuals: [],
        newest: undefined,
        ...extra,
      };
      built.set(key, fresh);
      return fresh;
    };
    for (const group of reading.groups) {
      const row = this.rowOf(group, named, open, reading.overMicros === 0 ? null : group.cores / cores);
      row.cores += group.cores;
      row.memoryBytes += group.memoryBytes;
      row.unread += group.unread;
      for (const one of group.processes)
        row.processes.push({
          pid: one.identity.pid,
          birth: one.identity.birth,
          name: one.name,
          command: one.command,
          role: one.role,
          share: one.cores === null ? null : one.cores / cores,
          reapedShare: one.reapedCores === undefined ? undefined : one.reapedCores / cores,
          memoryBytes: one.memoryBytes,
          killable: one.signal && row.kind !== 'installation' && row.kind !== 'kernel',
          unread: one.unread,
        });
      if (group.owner._tag === 'Execution' && group.owner.ended)
        for (const one of group.processes) row.residuals.push({ origin: group.owner.execution, pid: one.identity.pid });
    }
    const share = reading.cpu === null ? null : reading.cpu / cores;
    const point: LoadPoint | undefined =
      reading.overMicros === 0
        ? undefined
        : {
            at: readAt,
            machine: share,
            own: [...built.values()].reduce((sum, row) => (OWN_KINDS.has(row.kind) ? sum + row.cores / cores : sum), 0),
            rows: Object.fromEntries(
              [...built.values()].flatMap((row) => (row.cores / cores >= DRAWN ? [[row.key, row.cores / cores] as const] : [])),
            ),
          };
    this.history = keptHistory(this.history, point);
    const recent = this.history.filter((one) => one.at >= readAt - RANK_MS);
    const totalMemory = reading.memory._tag === 'Measured' ? reading.memory.totalBytes : undefined;
    const titles = new Map<string, number>();
    for (const row of built.values()) titles.set(row.title, (titles.get(row.title) ?? 0) + 1);
    const rows: LoadRow[] = [...built.values()].map((row) => {
      const rowShare = row.cores / cores;
      const rank = recent.length === 0 ? rowShare : recent.reduce((sum, one) => sum + (one.rows[row.key] ?? 0), 0) / recent.length;
      const live = row.newest !== undefined && !row.newest.ended;
      return {
        key: row.key,
        kind: row.kind,
        title: row.title,
        detail:
          row.kind !== 'agent'
            ? (row.detail ?? ((titles.get(row.title) ?? 0) > 1 ? row.where : undefined) ?? row.project?.name)
            : row.newest === undefined
              ? undefined
              : live
                ? row.newest.work.label
                : `left running after ${row.newest.work.label}`,
        project: row.project,
        thread: row.thread,
        share: rowShare,
        rank,
        memoryBytes: row.memoryBytes,
        unread: row.unread,
        minor: !OWN_KINDS.has(row.kind) && rank < MINOR && (totalMemory === undefined || row.memoryBytes < totalMemory * MINOR),
        processes: row.processes.sort((left, right) => (right.share ?? 0) - (left.share ?? 0)),
        work: row.executions.length + row.residuals.length === 0 ? undefined : { executions: row.executions, residuals: row.residuals },
      };
    });
    rows.sort((left, right) => right.rank - left.rank || right.memoryBytes - left.memoryBytes);
    const outside = rows.filter((row) => !OWN_KINDS.has(row.kind));
    const own = totalOf(
      rows.filter((row) => OWN_KINDS.has(row.kind)),
      reading,
    );
    const counted = totalOf(outside, reading);
    const saturation = this.history.filter((one) => one.at >= readAt - SATURATION_MS && one.machine !== null);
    const heaviest = rows.find((row) => OWN_KINDS.has(row.kind));
    const unread = [reading.unread, named.unread].filter((one) => one !== undefined).join('; ');
    return {
      point,
      view: {
        scope: reading.scope,
        readAt,
        cores,
        share,
        memory: reading.memory,
        saturated: saturation.length >= 2 && saturation.reduce((sum, one) => sum + (one.machine ?? 0), 0) / saturation.length >= SATURATED,
        rows,
        totals: {
          own,
          agent: totalOf(
            rows.filter((row) => row.kind === 'agent'),
            reading,
          ),
          work: totalOf(
            rows.filter((row) => row.kind === 'work'),
            reading,
          ),
          outside:
            reading.memory._tag === 'Measured' && own.memoryBytes !== null
              ? { ...counted, memoryBytes: Math.max(0, reading.memory.usedBytes - own.memoryBytes) }
              : counted,
          others: totalOf(
            outside.filter((row) => row.minor),
            reading,
          ),
        },
        top:
          heaviest !== undefined && heaviest.rank >= TOP ? { key: heaviest.key, title: heaviest.title, share: heaviest.rank } : undefined,
        background,
        unread: unread === '' ? undefined : unread,
      },
    };
  }

  private rowOf(
    group: LoadGroup,
    named: Named,
    open: (key: string, kind: LoadRowKind, title: string, extra?: Partial<Building>) => Building,
    share: number | null,
  ) {
    const owner = group.owner;
    switch (owner._tag) {
      case 'Installation':
        return open('tagma', 'installation', 'Tagma', { detail: 'server, agents, host, window' });
      case 'Kernel':
        return open('system', 'kernel', 'System', {
          detail: 'the kernel and interrupts: machine CPU no listed process accounts for',
        });
      case 'Program':
        return open(`program:${owner.key}`, 'program', owner.name, { where: owner.where });
      case 'Execution': {
        const work = named.work.get(owner.execution.execution);
        const thread = work?.thread;
        const title = thread === undefined ? undefined : named.threads.get(thread)?.title;
        const row =
          thread === undefined
            ? open(`work:${commandKey(owner.execution)}`, 'work', work?.label ?? `command ${owner.execution.execution.slice(0, 8)}`)
            : open(`agent:${thread}`, 'agent', title ?? `thread ${thread.slice(-8)}`, { thread });
        if (work === undefined) return row;
        if (!owner.ended)
          row.executions.push({
            projectId: work.projectId,
            key: commandKey(owner.execution),
            kind: work.kind,
            transport: work.transport,
            execution: owner.execution,
            session: work.session,
            label: work.label,
            share,
            memoryBytes: group.memoryBytes,
          });
        if (work.session) {
          if (row.project === undefined && work.project !== undefined) row.project = { id: work.projectId, name: work.project };
          return row;
        }
        const newer =
          row.newest === undefined ||
          (row.newest.ended && !owner.ended) ||
          (row.newest.ended === owner.ended && work.since > row.newest.work.since);
        if (newer) {
          row.newest = { work, ended: owner.ended };
          row.project = work.project === undefined ? undefined : { id: work.projectId, name: work.project };
        }
        return row;
      }
    }
  }
}
